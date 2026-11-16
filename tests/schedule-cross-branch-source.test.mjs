const OWNER_DOCUMENT_RELEASE='takodeal-manager-core-v158-plotted-payroll-20261116-r1';
import {legacyCompatibilityRead} from './helpers/compatibility-release-inverse.mjs';
const _plottedRawFs=(...args)=>legacyCompatibilityRead(_compatibilityRawFs(...args),args[0]);
import {legacyPlottedRead,normalizePlottedGitResult} from './helpers/plotted-release-inverse.mjs';
const readFileSync=(...args)=>legacyPlottedRead(_plottedRawFs(...args),args[0]);
const execFileSync=(...args)=>normalizePlottedGitResult(_plottedRawExec(...args),args[0],args[1]);
import {isHistoricalManualAttendanceChange} from './helpers/manual-attendance-simple-inverse.mjs';
import {isCommissaryModule} from './helpers/commissary-inverse.mjs';
import {restoreBranchInventorySetup,branchInventorySetupProof} from './helpers/branch-inventory-setup-inverse.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync as _compatibilityRawFs} from 'node:fs';
import {execFileSync as _plottedRawExec} from 'node:child_process';
import {scheduleCrossBranchProof as proof,restoreScheduleCrossBranch,scheduleCrossBranchSha} from './helpers/schedule-cross-branch-inverse.mjs';
import {OWNER_DOCUMENT_RELEASE as LIVE_OWNER_DOCUMENT_RELEASE} from '../takodeal-manager/owner-update-notice.js';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8');
test('the schedule release preserves every deployed Owner byte outside its exact reviewed files',()=>{
 const product=['takodeal-manager','Takodeal-POS','takodeal-staff','Customer','takodeal-franchise','takodeal-delivery','functions','firestore.rules','firestore.policy.rules'];
 const changed=execFileSync('git',['diff','--name-only',proof.base,'--',...product],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean).filter(file=>isHistoricalManualAttendanceChange(file,proof.base)).filter(file=>!isCommissaryModule(file)).filter(file=>!Object.hasOwn(branchInventorySetupProof.newFiles,file)).filter(file=>!Object.hasOwn(branchInventorySetupProof.files,file)||Object.hasOwn(proof.files,file)).sort();
 assert.deepEqual(changed,Object.keys(proof.files).sort());
 for(const [file,row]of Object.entries(proof.files)){
  const source=restoreBranchInventorySetup(read(file),file),baseline=execFileSync('git',['show',proof.base+':'+file],{cwd:root,encoding:'utf8',maxBuffer:4e6});
  assert.equal(scheduleCrossBranchSha(source),row.candidateSha256);
  assert.equal(restoreScheduleCrossBranch(source,file),baseline);
  assert.notEqual(restoreScheduleCrossBranch(source+'\n// unexpected edit',file),baseline);
 }
});
test('the page, entry module, service worker and update notice identify the same schedule release',()=>{
 const release='plotted-payroll-20261116-r1';assert.equal(OWNER_DOCUMENT_RELEASE,'takodeal-manager-core-v158-'+release);
 assert.ok(read('takodeal-manager/sw.js').includes(OWNER_DOCUMENT_RELEASE));
 assert.ok(read('takodeal-manager/auth.js').includes('main.js?v='+release));
 const html=read('takodeal-manager/index.html');assert.ok(html.includes('content="'+release+'"'));assert.ok(html.includes('auth.js?v='+release));
});

test('current document release matches this compatibility generation',()=>assert.equal(LIVE_OWNER_DOCUMENT_RELEASE,'takodeal-manager-core-v160-worked-shift-review-20261116-r1'));
