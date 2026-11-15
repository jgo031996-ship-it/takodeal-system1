import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {cashierOwnerRegisterProof as proof,cashierOwnerRegisterSha as sha,restoreCashierOwnerRegister as restore} from './helpers/cashier-owner-register-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8'),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:7e6});
test('the read-only Owner fix restores the exact live Cashier source and pins its sole new leaf',()=>{
 assert.equal(proof.base,'097e0992c2f218526425afa6dfe134752fd0fd4e');
 const scopes=['Takodeal-POS','takodeal-manager','takodeal-staff','takodeal-franchise','takodeal-delivery','Customer','functions','firestore.rules','firestore.policy.rules','storage.rules'];
 const changed=new Set([...git('diff','--name-only',proof.base,'--',...scopes).split(/\r?\n/),...git('ls-files','--others','--exclude-standard','--',...scopes).split(/\r?\n/)].filter(Boolean));
 assert.deepEqual([...changed].sort(),[...Object.keys(proof.files),...Object.keys(proof.newFiles)].sort());
 for(const file of Object.keys(proof.files)){assert.equal(restore(read(file),file),git('show',proof.base+':'+file));assert.throws(()=>restore(read(file)+'\n// unreviewed',file));}
 for(const [file,pin] of Object.entries(proof.newFiles))assert.equal(sha(read(file)),pin);
 for(const file of ['Takodeal-POS/cashier-owner-workspace.js','Takodeal-POS/pos-safety.js','Takodeal-POS/pos-checkout.js','Takodeal-POS/cashier-startup.js','Takodeal-POS/shift-sales.js','Takodeal-POS/cash-settlement.js'])assert.equal(read(file),git('show',proof.base+':'+file));
});
test('cache, entry and release notice agree and cache the Owner register leaf',()=>{
 assert.ok(read('Takodeal-POS/sw.js').includes("const CORE = 'takodeal-pos-core-"+proof.release+"';"));assert.ok(read('Takodeal-POS/index.html').includes('main.js?v='+proof.release));assert.ok(read('Takodeal-POS/cashier-data.js').includes("CASHIER_RELEASE = '"+proof.release+"'"));assert.ok(read('Takodeal-POS/sw.js').includes("'./cashier-owner-register.js'"));
 assert.doesNotMatch(read('Takodeal-POS/cashier-owner-register.js'),/signIn|updateDoc|runTransaction|addDoc|setDoc|localStorage|syncOfflineQueue|getPendingSales/);
});
