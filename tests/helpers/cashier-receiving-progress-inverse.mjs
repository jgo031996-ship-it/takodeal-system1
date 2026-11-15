import {normalizeSimpleVoid} from './cashier-simple-void-inverse.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const cashierReceivingProgressProof=JSON.parse(readFileSync(new URL('../fixtures/cashier-receiving-progress-inverse.json',import.meta.url),'utf8'));
export const cashierReceivingProgressSha=source=>createHash('sha256').update(source).digest('hex');
export function restoreCashierReceivingProgress(source,file){
 source=normalizeSimpleVoid(source,file);
 const row=cashierReceivingProgressProof.files[file];if(!row||cashierReceivingProgressSha(source)===row.baselineSha256)return source;
 assert.equal(cashierReceivingProgressSha(source),row.candidateSha256,'Only reviewed receiving progress edits: '+file);
 for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Unique receiving progress edit: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(cashierReceivingProgressSha(source),row.baselineSha256,'Every other current live byte stays exact: '+file);return source;
}
export function normalizeCashierReceivingProgress(source,file){source=normalizeSimpleVoid(source,file);return cashierReceivingProgressProof.files[file]?.candidateSha256===cashierReceivingProgressSha(source)?restoreCashierReceivingProgress(source,file):source;}
