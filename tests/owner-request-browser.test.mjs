import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const chrome=['/usr/bin/google-chrome','/usr/bin/chromium','/opt/google/chrome/chrome'].find(existsSync);
const root=new URL('../takodeal-manager/',import.meta.url);
const fixture=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/owner-request-dialog.css"></head><body><output id="result">pending</output>
<script type="module">
import {installOwnerRequestDialog} from '/owner-request-dialog.js';
import {OWNER_EMAIL} from '/workspace-access-model.js';
try{
 const start='2026-11-13T09:30:00Z',end='2026-11-13T18:00:00Z',workDate='2026-11-13';
 const p={shiftId:'night',shiftName:'Night 1',workDate,expectedStartAt:start,expectedEndAt:end,sourceRevisionId:'original',branch:'QA'};
 const request={type:'Reason Letter',id:'test-letter',status:'Pending',branch:'QA',staffId:'crew',staffName:'Test Crew',attendanceLogId:'in',staffShiftProposal:p};
 const attendance={id:'in',branch:'QA',staffId:'crew',staffName:'Test Crew'};
 const choice={...p,key:'night',reportedRevisionId:'original',occupied:true,attendanceOnly:true,blockers:[],undatedLeaveIds:[]};
 let saves=0;
 const api={auth:{currentUser:{uid:'synthetic',email:OWNER_EMAIL,emailVerified:true,providerData:[{providerId:'google.com'}]}},
 sessionUser:{uid:'synthetic',email:OWNER_EMAIL,isOwner:true,permissions:['all'],allowedBranches:['All']},isBranchAllowed:()=>true,
 workedShiftCorrectionUI:{service:{inspect:async()=>({blockers:[],choices:[choice],timeInAt:start,timeOutAt:end}),propose:()=>choice,apply:async()=>{saves++;}}}};
 const dialog=installOwnerRequestDialog(api,document,{makeService:()=>api.workedShiftCorrectionUI.service});
 const node=await dialog.open({request,attendance,profileId:'crew'});
 const button=node.querySelector('[data-save]');
 button.focus();button.scrollIntoView({block:'center'});
 const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
 if(document.activeElement!==button||button.disabled||hit!==button||r.height<44||document.documentElement.scrollWidth>innerWidth)throw Error('Primary action is obscured or outside the viewport');
 hit.click();await new Promise(resolve=>setTimeout(resolve,20));
 if(saves!==1||node.open)throw Error('Click did not complete the decision');
 api.workedShiftCorrectionUI.service.inspect=async()=>{throw Error('Time Out is missing');};
 let linked;api.openAttendanceRecovery=context=>{linked=context.attendanceLogId;};
 const blocked=await dialog.open({request,attendance,profileId:'crew'}),next=blocked.querySelector('[data-save]');
 if(next.disabled||next.textContent!=='Open linked attendance')throw Error('No usable recovery action');
 next.click();await Promise.resolve();if(linked!=='in'||saves!==1)throw Error('Wrong recovery target');
 if(innerWidth!==Number(location.search.slice(1)))throw Error('Unexpected CSS viewport '+innerWidth);
 document.querySelector('output').textContent='checked';parent.postMessage('checked',location.origin);
}catch(error){document.querySelector('output').textContent=error.message;parent.postMessage(error.message,location.origin);}
</script></body></html>`;
test('browser can focus and click the Owner decision and its recovery action at phone and desktop widths',{skip:!chrome,timeout:60000},async()=>{
 const server=createServer(async(req,res)=>{
  if(/^\/frame\?(390|1280)$/.test(req.url)){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
  if(/^\/\?(390|1280)$/.test(req.url)){
   const width=Number(req.url.slice(2));res.setHeader('Content-Type','text/html');
   res.end('<output id="result">pending</output><script>onmessage=e=>{if(e.origin===location.origin)document.querySelector("output").textContent=e.data}</script><iframe style="width:'+width+'px;height:650px;border:0" src="/frame?'+width+'"></iframe>');return;
  }
  if(!/^\/[\w.-]+\.(js|css)$/.test(req.url)){res.writeHead(404).end();return;}
  try{const file=await readFile(new URL(req.url.slice(1),root));res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(file);}
  catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{for(const width of [390,1280]){
  const profile=await mkdtemp(join(tmpdir(),'owner-request-browser-'));
  try{const {stdout}=await promisify(execFile)(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--no-first-run','--user-data-dir='+profile,'--window-size='+width+',720','--virtual-time-budget=2500','--dump-dom','http://127.0.0.1:'+server.address().port+'/?'+width],{timeout:22000,maxBuffer:2e6});
   assert.match(stdout,/<output id="result">checked<\/output>/,'Browser width '+width+': '+stdout.match(/<output[^>]*>[^<]*/)?.[0]);}
  finally{await rm(profile,{recursive:true,force:true,maxRetries:3});}
 }}finally{await new Promise(resolve=>server.close(resolve));}
});
