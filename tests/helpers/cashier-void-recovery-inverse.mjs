import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const proof=JSON.parse(readFileSync(new URL('../fixtures/cashier-void-recovery-inverse.json',import.meta.url))),sha=value=>createHash('sha256').update(value).digest('hex');
export function restoreCashierVoidRecovery(source,file){
 const record=proof.files[file];if(!record||sha(source)===record.baselineSha256)return source;
 assert.equal(sha(source),record.candidateSha256,'Only the reviewed receipt recovery hooks may change: '+file);
 for(const edit of [...record.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Exact reviewed receipt recovery hunk: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(sha(source),record.baselineSha256,'All unrelated bytes retain exact live d107: '+file);return source;
}
