import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const base='eec6eca0e82aa5b16932d5b30e959d0254feb87a',prefix='functions/cash-remittance-review/',root=new URL('../',import.meta.url);
const allowed=['owner-time-out-handler.mjs','owner-time-out-service.mjs'].map(file=>prefix+file),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true,maxBuffer:8e6});
function baseline(){
 const paths=git('ls-tree','-r','--name-only',base,'--',prefix).toString().trim().split(/\r?\n/).filter(path=>/\.(?:js|mjs|json)$/.test(path));
 assert.equal(paths.length,66);const blobs=execFileSync('git',['cat-file','--batch'],{cwd:root,input:paths.map(path=>base+':'+path+'\n').join(''),windowsHide:true,maxBuffer:8e6}),result={};let offset=0;
 for(const path of paths){const end=blobs.indexOf(10,offset),match=/^[a-f0-9]{40} blob (\d+)$/.exec(blobs.subarray(offset,end).toString());assert.ok(match);const start=end+1,length=Number(match[1]);assert.equal(blobs[start+length],10);result[path]=sha(blobs.subarray(start,start+length));offset=start+length+1;}
 assert.equal(offset,blobs.length);return result;
}
test('manual backend preserves all 64 unrelated actual live source files and changes exactly the two reviewed endpoints',()=>{
 const expected=baseline(),proof=JSON.parse(readFileSync(new URL('./fixtures/manual-missing-backend-inverse.json',import.meta.url))),changed=[];
 for(const [path,hash]of Object.entries(expected)){const bytes=readFileSync(new URL(path,root));if(sha(bytes)!==hash)changed.push(path);}
 assert.deepEqual(changed.sort(),allowed);for(const row of proof.runtimeFiles){assert.equal(row.baseSha256,expected[row.path],'Owner leaf baseline equals actual 66-file live source');assert.equal(sha(readFileSync(new URL(row.path,root))),row.sha256);}
});
test('backend release includes no changes to applications, other functions, authorization policies or indexes',()=>{
 const scope=['functions','Takodeal-POS','takodeal-manager','takodeal-staff','takodeal-franchise','takodeal-delivery','Customer','firestore.rules','firestore.policy.rules','storage.rules','firestore.indexes.json'];
 const changed=new Set([...git('diff','--name-only',base,'--',...scope).toString().split(/\r?\n/),...git('ls-files','--others','--exclude-standard','--',...scope).toString().split(/\r?\n/)].filter(Boolean));assert.deepEqual([...changed].sort(),allowed);
});
