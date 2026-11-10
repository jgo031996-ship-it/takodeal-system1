import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const proof=JSON.parse(readFileSync(new URL('../fixtures/cashier-unit-snapshot-inverse.json',import.meta.url),'utf8')),sha=x=>createHash('sha256').update(x).digest('hex');
export function restoreCashierUnitSnapshots(source){
 if(sha(source)===proof.baselineSha256)return source;
 assert.equal(sha(source),proof.candidateSha256,'Exact reviewed unit-snapshot delta');
 for(const edit of [...proof.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Unique reviewed unit-snapshot hunk');source=source.replace(edit.after,()=>edit.before);}
 assert.equal(sha(source),proof.baselineSha256,'Every unrelated sale-engine byte retained');return source;
}
