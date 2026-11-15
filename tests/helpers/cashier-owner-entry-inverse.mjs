import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {normalizeCashierOwnerWorkspace} from './cashier-owner-workspace-inverse.mjs';
export const cashierOwnerEntryProof=JSON.parse(readFileSync(new URL('../fixtures/cashier-owner-entry-inverse.json',import.meta.url),'utf8'));
export const cashierOwnerEntrySha=value=>createHash('sha256').update(value).digest('hex');
export function restoreCashierOwnerEntry(source,file){
 source=normalizeCashierOwnerWorkspace(source,file);
 const row=cashierOwnerEntryProof.files[file];if(!row||cashierOwnerEntrySha(source)===row.baselineSha256)return source;
 assert.equal(cashierOwnerEntrySha(source),row.candidateSha256,'Only the reviewed Owner entry/cache hunks: '+file);
 for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Unique Owner entry hunk: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(cashierOwnerEntrySha(source),row.baselineSha256,'Every other live dfa byte stays exact: '+file);return source;
}
