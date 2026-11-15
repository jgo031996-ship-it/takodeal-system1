import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {plottedProof as proof,plottedSha as sha,restorePlottedRelease as restore} from './helpers/plotted-release-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8'),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:8e6});
test('the complete plotted-attendance release has an exact inverse to its deployed app base and pins every new dependency',()=>{
 assert.ok(['ec0386460da3081bee400f81a301c1eb63dc2853','609e15ec965101e32d8ee3f85688fc673e113d41','74a0adf0b8f2180fd0ddda0967ac1b5095af25f1'].includes(proof.base));
 const scopes=['Takodeal-POS','takodeal-manager','takodeal-staff','takodeal-franchise','takodeal-delivery','Customer','functions','firestore.rules','firestore.policy.rules','storage.rules'];
 const changed=new Set([...git('diff','--name-only',proof.base,'--',...scopes).split(/\r?\n/),...git('ls-files','--others','--exclude-standard','--',...scopes).split(/\r?\n/)].filter(Boolean));assert.deepEqual([...changed].sort(),[...Object.keys(proof.files),...Object.keys(proof.newFiles)].sort());
 for(const file of Object.keys(proof.files)){assert.equal(restore(read(file),file),git('show',proof.base+':'+file));assert.throws(()=>restore(read(file)+'\n// unreviewed',file));}
 for(const [file,pin]of Object.entries(proof.newFiles))assert.equal(sha(read(file)),pin);
 for(const file of ['firestore.rules','Takodeal-POS/pos-safety.js','Takodeal-POS/pos-checkout.js','takodeal-manager/payroll-settlement.js'])assert.equal(read(file),git('show',proof.base+':'+file));
});
test('all apps share the plotted slot bounds and Staff/Cashier use the same preview guard',()=>{
 const model=read('takodeal-manager/payroll-safety.js');for(const dir of ['Takodeal-POS','takodeal-staff','takodeal-franchise'])assert.equal(read(dir+'/payroll-safety.js'),model);assert.equal(read('Takodeal-POS/attendance-schedule-preview.js'),read('takodeal-staff/attendance-schedule-preview.js'));
 if(proof.kind!=='owner'){assert.equal(read('Takodeal-POS/plotted-time-in.js'),read('takodeal-staff/plotted-time-in.js'));assert.doesNotMatch(read('Takodeal-POS/plotted-time-in.js'),/signIn|signOut|deleteDoc|deleteDatabase|localStorage/);}
});
test('the deployed app cache and entry URLs agree on this release',()=>{
 if(proof.kind==='cashier'){
  assert.ok(read('Takodeal-POS/sw.js').includes("const CORE = 'takodeal-pos-core-"+proof.release+"';"));assert.ok(read('Takodeal-POS/index.html').includes('main.js?v='+proof.release));assert.ok(read('Takodeal-POS/cashier-data.js').includes(proof.release));assert.ok(read('Takodeal-POS/sw.js').includes("'./plotted-time-in.js'"));
 }else if(proof.kind==='staff'){
  assert.ok(read('takodeal-staff/sw.js').includes("const STAFF_RELEASE = '"+proof.release+"';"));assert.ok(read('takodeal-staff/index.html').includes('app.js?v='+proof.release));assert.ok(read('takodeal-staff/staff-startup.js').includes(proof.release));assert.ok(read('takodeal-staff/sw.js').includes("'./plotted-time-in.js'"));
 }else{
  const cache='takodeal-manager-core-v158-'+proof.release;assert.ok(read('takodeal-manager/sw.js').includes(cache));assert.ok(read('takodeal-manager/owner-update-notice.js').includes(cache));assert.ok(read('takodeal-manager/auth.js').includes('main.js?v='+proof.release));assert.ok(read('takodeal-manager/index.html').includes('auth.js?v='+proof.release));
 }
});
