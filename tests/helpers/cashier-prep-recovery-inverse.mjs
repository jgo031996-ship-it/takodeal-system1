import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const proof=JSON.parse(readFileSync(new URL('../fixtures/cashier-prep-recovery-inverse.json',import.meta.url))),sha=value=>createHash('sha256').update(value).digest('hex');
export function restoreCashierPrepRecovery(source,file){
 const row=proof.files[file];if(!row||sha(source)===row.baselineSha256)return source;
 assert.equal(sha(source),row.candidateSha256,'Only the reviewed prep recovery hunks: '+file);
 for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Unique prep recovery hunk: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(sha(source),row.baselineSha256,'Exact live bedf prep source restored: '+file);return source;
}
