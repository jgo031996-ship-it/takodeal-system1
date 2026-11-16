import {legacyCompatibilityRead,normalizeCompatibilityGitResult} from './helpers/compatibility-release-inverse.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {ownerAccessProof as proof,restoreOwnerAccess,ownerAccessSha} from './helpers/owner-access-history-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>legacyCompatibilityRead(readFileSync(new URL(file,root),'utf8'),new URL(file,root)),git=(...args)=>normalizeCompatibilityGitResult(execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:8e6}),'git',args);
test('portable Owner inspection/history is exactly seven reviewed files against the published Cashier tree',()=>{
 assert.equal(proof.base,'ca6a7862a215545d04cb2ee11820477e9e71e6a7');const scope=['Takodeal-POS','takodeal-manager','takodeal-staff','takodeal-franchise','takodeal-delivery','Customer','functions','firestore.rules','firestore.policy.rules'];
 const changed=new Set([...git('diff','--name-only',proof.base,'--',...scope).split(/\r?\n/),...git('ls-files','--others','--exclude-standard','--',...scope).split(/\r?\n/)].filter(Boolean));assert.deepEqual([...changed].sort(),Object.keys(proof.files).sort());assert.equal(changed.size,7);
 for(const [file,row]of Object.entries(proof.files)){assert.equal(ownerAccessSha(read(file)),row.candidateSha256);assert.equal(restoreOwnerAccess(read(file),file),git('show',proof.base+':'+file));assert.throws(()=>restoreOwnerAccess(read(file)+'\n// unreviewed',file));}
});
test('published void, payment, drawer, stock, clock, payroll, Auth binding and backend engines remain unchanged',()=>{
 for(const file of ['Takodeal-POS/cashier-void.js','Takodeal-POS/cashier-void-access.js','Takodeal-POS/pos-checkout.js','Takodeal-POS/pos-safety.js','Takodeal-POS/cash-settlement.js','Takodeal-POS/remittance-safety.js','Takodeal-POS/dispatch-safety.js','Takodeal-POS/cashier-device-auth.js','Takodeal-POS/cashier-protected-action.js','Takodeal-POS/payroll-safety.js','Takodeal-POS/plotted-time-in.js','firestore.rules'])assert.equal(read(file),git('show',proof.base+':'+file),file);
 assert.doesNotMatch(read('Takodeal-POS/cashier-owner-register.js'),/updateDoc|setDoc|addDoc|runTransaction|signIn|signOut|syncOfflineQueue|getPendingSales/);
});
test('the actual page, worker and update notice publish this same release with every local import cached',()=>{
 const sw=read('Takodeal-POS/sw.js');assert.ok(sw.includes("const CORE = 'takodeal-pos-core-"+proof.release+"';"));assert.ok(read('Takodeal-POS/cashier-data.js').includes(proof.release));assert.ok(read('Takodeal-POS/index.html').includes('main.js?v='+proof.release));assert.ok(sw.includes("const PHOTOS = 'takodeal-pos-photos-offline02'"));for(const file of ['cashier-owner-register.js','cashier-owner-workspace.js','cashier-startup.js','cashier-void.js','cashier-void-access.js','plotted-time-in.js'])assert.ok(sw.includes("'./"+file+"'"),file);
});
