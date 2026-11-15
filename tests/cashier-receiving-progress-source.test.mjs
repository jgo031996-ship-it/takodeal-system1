import {simpleVoidProof,legacyVoidSource,simpleVoidOnlyChange} from './helpers/cashier-simple-void-inverse.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {cashierReceivingProgressProof as proof,restoreCashierReceivingProgress as restore} from './helpers/cashier-receiving-progress-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>legacyVoidSource(readFileSync(new URL(file,root),'utf8'),file),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:7e6});
test('receiving progress restores every reviewed hunk to the exact current live base with no other app, financial or authority changes',()=>{
 assert.equal(proof.base,'5eb848175590e741fd4ec8536c4e07d1c9370eb3');assert.equal(Object.keys(proof.files).length,5);
 const scopes=['Takodeal-POS','takodeal-manager','takodeal-staff','takodeal-franchise','takodeal-delivery','Customer','functions','firestore.rules','firestore.policy.rules','storage.rules'];
 const changed=new Set([...git('diff','--name-only',proof.base,'--',...scopes).split(/\r?\n/),...git('ls-files','--others','--exclude-standard','--',...scopes).split(/\r?\n/)].filter(Boolean));for(const file of [...changed])if(simpleVoidOnlyChange(file,read,()=>git('show',proof.base+':'+file)))changed.delete(file);assert.deepEqual([...changed].sort(),Object.keys(proof.files).sort());
 for(const file of Object.keys(proof.files)){assert.equal(restore(read(file),file),git('show',proof.base+':'+file));assert.throws(()=>restore(read(file)+'\n// unreviewed',file));}
 for(const file of ['Takodeal-POS/dispatch-safety.js','Takodeal-POS/cashier-owner-workspace.js','Takodeal-POS/cashier-owner-register.js','Takodeal-POS/pos-safety.js','takodeal-manager/pos-safety.js','Takodeal-POS/pos-checkout.js','Takodeal-POS/cashier-device-auth.js','Takodeal-POS/cashier-prep-access.js','Takodeal-POS/cashier-void-access.js'])assert.equal(read(file),git('show',proof.base+':'+file),file);
 for(const file of ['tests/fixtures/cashier-owner-register-inverse.json','tests/fixtures/cashier-owner-workspace-inverse.json','tests/fixtures/large-delivery-status-inverse.json'])assert.equal(read(file),git('show',proof.base+':'+file),file);
});
test('receipt-triggered inventory-sheet loads are absent and cache labels remain coherent with the existing policy and assets',()=>{
 const main=read('Takodeal-POS/main.js'),start=main.indexOf('window.submitGroupedDispatch = async function('),end=main.indexOf('\n};',start)+3;
 assert.doesNotMatch(main.slice(start,end),/loadStockRequestUI|setTimeout|Promise\.race/);assert.doesNotMatch(main,/submitGroupedDispatch\([^\n]+setTimeout/);
 assert.ok(read('Takodeal-POS/index.html').includes('main.js?v='+simpleVoidProof.release));assert.ok(read('Takodeal-POS/cashier-data.js').includes("CASHIER_RELEASE = '"+simpleVoidProof.release+"'"));assert.ok(read('Takodeal-POS/sw.js').includes("const CORE = 'takodeal-pos-core-"+simpleVoidProof.release+"';"));
 assert.match(read('Takodeal-POS/sw.js'),/const PHOTOS = 'takodeal-pos-photos-offline02'/);
});
