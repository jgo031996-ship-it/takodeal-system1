import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {simpleVoidProof as proof,restoreSimpleVoid as restore} from './helpers/cashier-simple-void-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8'),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:7e6});
test('five reviewed product files restore the exact live Cashier release while checkout, backend, rules and other apps stay unchanged',()=>{
 assert.equal(proof.base,'f5eea7bb1ab8baee2556d181bc7ff3ca33402cbb');const scopes=['Takodeal-POS','takodeal-manager','takodeal-staff','takodeal-franchise','takodeal-delivery','Customer','functions','firestore.rules','firestore.policy.rules','storage.rules'];
 const changed=new Set([...git('diff','--name-only',proof.base,'--',...scopes).split(/\r?\n/),...git('ls-files','--others','--exclude-standard','--',...scopes).split(/\r?\n/)].filter(Boolean));assert.deepEqual([...changed].sort(),Object.keys(proof.files).sort());
 for(const file of Object.keys(proof.files)){assert.equal(restore(read(file),file),git('show',proof.base+':'+file));assert.throws(()=>restore(read(file)+'\n// unreviewed',file));}
 for(const file of ['Takodeal-POS/main.js','Takodeal-POS/pos-checkout.js','Takodeal-POS/pos-safety.js','Takodeal-POS/cashier-correction-engine.js','Takodeal-POS/cashier-void-model.js','Takodeal-POS/cashier-void-queue.js','Takodeal-POS/cashier-owner-register.js','Takodeal-POS/cashier-incoming-deliveries.js','firestore.rules'])assert.equal(read(file),git('show',proof.base+':'+file));
});
test('the app cache and update notice share the new release without clearing saved financial data',()=>{
 assert.ok(read('Takodeal-POS/index.html').includes('main.js?v='+proof.release));assert.ok(read('Takodeal-POS/sw.js').includes("const CORE = 'takodeal-pos-core-"+proof.release+"';"));assert.ok(read('Takodeal-POS/cashier-data.js').includes("CASHIER_RELEASE = '"+proof.release+"'"));assert.match(read('Takodeal-POS/sw.js'),/const PHOTOS = 'takodeal-pos-photos-offline02'/);assert.doesNotMatch(read('Takodeal-POS/cashier-void.js'),/deleteDatabase|localStorage\.clear|removeItem\(/);
});
