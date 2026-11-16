import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const root=new URL('../takodeal-staff/',import.meta.url);
const browser=['/usr/bin/google-chrome','/usr/bin/chromium','/opt/google/chrome/chrome'].find(existsSync);

const exercise=`<script type="module">
import {installEmployeeProfileSections} from '/staff-employee-sections.js';
try {
    const modal=document.getElementById('profileModal');
    modal.style.display='flex';
    const sections=installEmployeeProfileSections(document);
    sections.show({cashierName:'Synthetic crew',role:'Service crew',branch:'Test branch',dateHired:'2025-01-01'});
    for(const name of ['employment','contact','pay','documents','security','personal']){
        const button=modal.querySelector('[data-profile-tab="'+name+'"]');
        button.scrollIntoView({block:'center'});button.focus();
        const rect=button.getBoundingClientRect();
        const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
        if(hit!==button||rect.height<44)throw Error('Cannot tap '+name+' at '+Math.round(rect.x)+','+Math.round(rect.y)+'; hit '+(hit?.id||hit?.tagName||'outside viewport'));
        hit.click();
        const panel=modal.querySelector('[data-profile-panel="'+name+'"]');
        if(!panel.getClientRects().length||modal.querySelectorAll('[data-profile-panel]:not([hidden])').length!==1)throw Error('Cannot open '+name);
        if(name==='employment'&&document.getElementById('staffHomeBranch').textContent!=='Test branch')throw Error('Employment details missing');
        if(name==='contact')document.getElementById('profPhone').value='synthetic value';
    }
    modal.querySelector('[data-profile-tab="contact"]').click();
    if(document.getElementById('profPhone').value!=='synthetic value')throw Error('Lost unsaved edit');
    if(modal.scrollWidth>modal.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1)throw Error('Horizontal overflow');
    sections.clear();
    if(document.getElementById('staffProfileName').textContent)throw Error('Private heading was not cleared');
    parent.postMessage('checked',location.origin);
}catch(error){parent.postMessage(error.message,location.origin)}
</script>`;

test('employees can tap all six profile sections at phone and desktop widths',{skip:!browser,timeout:75000},async()=>{
    const page=await readFile(new URL('index.html',root),'utf8');
    const profile=page.slice(page.indexOf('<div id="profileModal"'),page.indexOf('<div id="requestModal"'));
    assert.ok(profile.includes('staffPanelSecurity'));
    const styles=['style.css','staff-theme.css','staff-documents.css','staff-employee.css'].map(name=>'<link rel="stylesheet" href="/'+name+'">').join('');
    const server=createServer(async(req,res)=>{
        if(req.url==='/frame'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'+styles+profile+exercise);return;}
        if(/^\/\?(390|1280)$/.test(req.url)){
            const width=Number(req.url.slice(2));res.setHeader('Content-Type','text/html');
            res.end('<output id="result">pending</output><script>onmessage=e=>{if(e.origin===location.origin)document.querySelector("output").textContent=e.data}</script><iframe style="width:'+width+'px;height:650px;border:0" src="/frame"></iframe>');return;
        }
        if(!/^\/[\w.-]+\.(js|css)$/.test(req.url)){res.writeHead(404).end();return;}
        try{const asset=await readFile(new URL(req.url.slice(1),root));res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(asset);}
        catch{res.writeHead(404).end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
        for(const width of [390,1280]){
            const dir=await mkdtemp(join(tmpdir(),'staff-employee-browser-'));
            try{
                const {stdout}=await promisify(execFile)(browser,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--no-first-run','--user-data-dir='+dir,'--window-size='+width+',720','--virtual-time-budget=3000','--dump-dom','http://127.0.0.1:'+server.address().port+'/?'+width],{timeout:25000,maxBuffer:2e6});
                assert.match(stdout,/<output id="result">checked<\/output>/,'Viewport '+width+' '+stdout.match(/<output[^>]*>[^<]*/)?.[0]);
            }finally{await rm(dir,{recursive:true,force:true,maxRetries:5});}
        }
    }finally{await new Promise(resolve=>server.close(resolve));}
});
