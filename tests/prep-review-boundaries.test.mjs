import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),base='650409386054048399ccda3675a2333fe4188833';
const git=args=>execFileSync('git',args,{cwd:root,windowsHide:true,maxBuffer:16*1024*1024});
const hash=value=>createHash('sha256').update(value).digest('hex');
const changed=new Set(['functions/cash-remittance-review/prep-handler.mjs','functions/cash-remittance-review/prep-model.mjs','functions/cash-remittance-review/prep-store.mjs']);
test('all existing backend runtime bytes outside the three reviewed prep modules remain exact live void650',()=>{
 const files=git(['ls-tree','-r','--name-only',base,'--','functions']).toString().trim().split('\n').filter(path=>/\.(?:m?js|json)$/.test(path));
 assert.ok(files.includes('functions/cash-remittance-review/cashier-void-store.mjs'));
 for(const path of files)if(!changed.has(path))assert.equal(hash(readFileSync(new URL('../'+path,import.meta.url))),hash(git(['show',base+':'+path])),path);
 const additions=git(['ls-files','--others','--exclude-standard','--','functions']).toString().trim().split('\n').filter(Boolean);
 const trackedAdditions=git(['diff',base,'--name-only','--diff-filter=A','--','functions']).toString().trim().split('\n').filter(Boolean);
 assert.deepEqual([...new Set([...additions,...trackedAdditions])],['functions/cash-remittance-review/prep-review-model.mjs']);
});
test('all six applications, Firestore/Storage rules, runtime package manifests and lockfiles remain byte-exact650',()=>{
 const scopes=['Takodeal-POS','takodeal-manager','takodeal-staff','takodeal-franchise','takodeal-delivery','Customer','firestore.rules','firestore.policy.rules','storage.rules'];
 assert.equal(git(['diff',base,'--name-only','--',...scopes]).toString().trim(),'');assert.equal(git(['ls-files','--others','--exclude-standard','--',...scopes]).toString().trim(),'');
 const files=git(['ls-tree','-r','--name-only',base,'--','functions']).toString().trim().split('\n').filter(path=>/package(?:-lock)?\.json$/.test(path));
 for(const path of files)assert.equal(hash(readFileSync(new URL('../'+path,import.meta.url))),hash(git(['show',base+':'+path])),path);
});
