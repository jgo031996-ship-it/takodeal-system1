import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
export const cashierPrepRecoveryReleaseProof=JSON.parse(readFileSync(new URL('../fixtures/cashier-prep-recovery-release-inverse.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
export function restoreCashierPrepRecoveryRelease(source,file){
 const row=cashierPrepRecoveryReleaseProof.files[file];if(!row)return source;
 assert.equal(sha(source),row.candidateSha256,'Only the reviewed receipt recovery release labels may change: '+file);
 for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Unique Cashier recovery release label: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(sha(source),row.baselineSha256,'All other live bedf bytes remain exact: '+file);return source;
}
