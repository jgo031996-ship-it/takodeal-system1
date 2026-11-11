import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {cashierPrepRecoveryReleaseProof as proof,restoreCashierPrepRecoveryRelease} from './helpers/cashier-prep-recovery-release-inverse.mjs';
import {restoreCashierVoidRecovery} from './helpers/cashier-void-recovery-inverse.mjs';
import {CASHIER_RELEASE} from '../Takodeal-POS/cashier-data.js';
const root=fileURLToPath(new URL('../',import.meta.url)),read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),sha=value=>createHash('sha256').update(value).digest('hex'),git=file=>execFileSync('git',['show',proof.base+':'+file],{cwd:root,windowsHide:true,maxBuffer:4*1024*1024});

test('three release labels restore every prior live page, worker and presentation-helper byte',()=>{
 assert.equal(proof.base,'bedf5b71d71e794fb08aac44db2717d3205a500c');assert.deepEqual(Object.keys(proof.files),['Takodeal-POS/index.html','Takodeal-POS/sw.js','Takodeal-POS/cashier-data.js']);assert.equal(Object.values(proof.files).reduce((n,row)=>n+row.edits.length,0),3);
 for(const file of Object.keys(proof.files))assert.deepEqual(Buffer.from(restoreCashierPrepRecoveryRelease(read(file),file)),git(file));
});

test('release normalization layers before the original void proof without changing historical hashes',()=>{
 const expected={'cashier-void-recovery-inverse.json':'81a60f1e9e09e19c486e1a022f9811c55487605ee63e21b22a7453f57b1b71af','cashier-prep-review-inverse.json':'419a39bc3cad18a4e42dc64f84f4cfb4b7e4e6bfc064d725e076216515c8fd75','cashier-owner-desktop-inverse.json':'5e0d0d01396c071c83fd19d4cc9001cf9c0b89bc1cd7c694e27d87606b5f8b91'};
 for(const [file,hash]of Object.entries(expected)){assert.equal(sha(read('tests/fixtures/'+file)),hash);assert.equal(proof.historicalProofs[file],hash);}
 const old=JSON.parse(read('tests/fixtures/cashier-void-recovery-inverse.json'));for(const file of Object.keys(proof.files))assert.equal(sha(restoreCashierVoidRecovery(read(file),file)),old.files[file].baselineSha256,file);
});

test('tampered release files fail held and main, checkout, engines and identity modules remain byte-exact live',()=>{
 for(const file of Object.keys(proof.files)){assert.throws(()=>restoreCashierPrepRecoveryRelease(read(file)+'\n// extra behavior',file));assert.throws(()=>restoreCashierPrepRecoveryRelease(read(file).replace(proof.release,'unreviewed'),file));}
 for(const file of ['Takodeal-POS/main.js','Takodeal-POS/pos-checkout.js','Takodeal-POS/pos-safety.js','takodeal-manager/pos-safety.js','Takodeal-POS/cashier-staff-access.js','Takodeal-POS/cashier-protected-action.js','Takodeal-POS/cashier-device-auth.js'])assert.deepEqual(Buffer.from(read(file)),git(file),file);
});

test('actual entry, update presentation and shell agree while photo and queue/cache behavior stay unchanged',()=>{
 assert.equal(CASHIER_RELEASE,'cashier-prep-recovery-20261111-r1');assert.equal(proof.release,CASHIER_RELEASE);assert.ok(read('Takodeal-POS/index.html').includes('main.js?v='+CASHIER_RELEASE));
 const sw=read('Takodeal-POS/sw.js');assert.ok(sw.includes("const CORE = 'takodeal-pos-core-"+CASHIER_RELEASE+"';"));assert.ok(sw.includes("const PHOTOS = 'takodeal-pos-photos-offline02';"));
 assert.equal(restoreCashierPrepRecoveryRelease(sw,'Takodeal-POS/sw.js'),git('Takodeal-POS/sw.js').toString(),'all routing, request and persistent-cache behavior is unchanged');
});
