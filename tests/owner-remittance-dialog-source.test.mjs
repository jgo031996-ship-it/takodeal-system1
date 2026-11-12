import {ownerHRRequestProof,restoreOwnerHRRequest} from './helpers/owner-hr-request-inverse.mjs';
import {ownerPrepYieldProof,restoreOwnerPrepYield} from './helpers/owner-prep-yield-inverse.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {ownerRemittanceDialogProof as proof,restoreOwnerRemittanceDialog} from './helpers/owner-remittance-dialog-inverse.mjs';
import {ownerStockWarningsProof,restoreOwnerStockWarnings} from './helpers/owner-stock-warnings-inverse.mjs';
import {ownerRemoteRequestProof,restoreOwnerRemoteRequest} from './helpers/owner-remote-staff-requests-inverse.mjs';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),git=file=>execFileSync('git',['show',proof.base+':'+file],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
test('exact five UI hunks in two files restore the full reviewed Owner release and reject any extra mutation',()=>{assert.equal(proof.base,'2759f14e703b41dc4894752f4f882d806db187e2');assert.equal(Object.keys(proof.files).length,2);assert.equal(Object.values(proof.files).reduce((n,row)=>n+row.edits.length,0),5);for(const file of Object.keys(proof.files)){assert.equal(restoreOwnerRemittanceDialog(file,read(file)),git(file));assert.throws(()=>restoreOwnerRemittanceDialog(file,read(file)+'\n// unreviewed change'));}});
test('financial receive/reject, audit opening, refresh and unsent-close methods are byte-identical',()=>{const file='takodeal-manager/cash-remittance-review-ui.js',before=git(file),after=read(file);for(const[name,end]of [['requestClose',' function ensure'],['open',' async function refreshSaved'],['refreshSaved',' async function receive'],['receive',' async function reject'],['reject',' const result=']]){const span=source=>{const start=source.indexOf(' async function '+name+'('),stop=source.indexOf('\n'+end,start+1);assert.ok(start>=0&&stop>start);return source.slice(start,stop);};assert.equal(span(after),span(before),name+' financial and identity guards retain every byte');}});
test('all other Owner/business/cache files, five clients, backends and policies stay at the reviewed release',()=>{
 const changed=execFileSync('git',['diff','--name-only',proof.base,'--','takodeal-manager','Takodeal-POS','takodeal-staff','Customer','takodeal-franchise','takodeal-delivery','functions','firestore.rules','firestore.policy.rules','storage.rules'],{cwd:root,encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/).filter(Boolean),allowed=new Set([...Object.keys(proof.files),...Object.keys(ownerStockWarningsProof.files),...Object.keys(ownerStockWarningsProof.newFiles),...Object.keys(ownerPrepYieldProof.files),...Object.keys(ownerPrepYieldProof.newFiles),...Object.keys(ownerHRRequestProof.files)]);
 assert.equal(ownerRemoteRequestProof.base,'147d0d9abedd21c98b036861efcff6e57856de52');assert.equal(Object.keys(ownerRemoteRequestProof.files).length,5);assert.equal(Object.values(ownerRemoteRequestProof.files).reduce((sum,row)=>sum+row.edits.length,0),10);
 const historicalChanges=changed.filter(file=>{
  if(!ownerRemoteRequestProof.files[file])return true;
  const current=read(file),restored=restoreOwnerRemoteRequest(file,current),baseline=execFileSync('git',['show',ownerRemoteRequestProof.base+':'+file],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
  assert.equal(restored,baseline,'Only the exact reviewed display/release inverse may precede the remittance comparison: '+file);
  assert.throws(()=>restoreOwnerRemoteRequest(file,current+'\n// unreviewed display change\n'));
  return restored!==git(file);
 });
 assert.ok(historicalChanges.every(file=>allowed.has(file)));
 for(const file of Object.keys(ownerStockWarningsProof.files))assert.equal(restoreOwnerStockWarnings(file,read(file)),execFileSync('git',['show',ownerStockWarningsProof.base+':'+file],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024}));for(const[file,hash]of Object.entries(ownerStockWarningsProof.newFiles))assert.equal(createHash('sha256').update(restoreOwnerPrepYield(file,read(file))).digest('hex'),hash);
});
