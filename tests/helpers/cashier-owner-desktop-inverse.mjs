import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreCashierVoidRecovery} from './cashier-void-recovery-inverse.mjs';
import {restoreCashierPrepRecovery} from './cashier-prep-recovery-inverse.mjs';
const proof=JSON.parse(readFileSync(new URL('../fixtures/cashier-owner-desktop-inverse.json',import.meta.url))),sha=value=>createHash('sha256').update(value).digest('hex');
export function restoreCashierOwnerDesktop(source,file){
 source=restoreCashierPrepRecovery(source,file);
 source=restoreCashierVoidRecovery(source,file);
 const record=proof.files[file];if(!record||sha(source)===record.baselineSha256)return source;
 assert.equal(sha(source),record.candidateSha256,'Only the reviewed Owner desktop context hooks may change: '+file);
 for(const edit of [...record.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Exact Owner desktop hunk: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(sha(source),record.baselineSha256,'Every other byte retains the live f8 behavior: '+file);return source;
}
