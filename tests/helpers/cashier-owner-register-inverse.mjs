import {normalizePlottedRelease} from './plotted-release-inverse.mjs';
import {normalizeCashierReceivingProgress} from './cashier-receiving-progress-inverse.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const cashierOwnerRegisterProof=JSON.parse(readFileSync(new URL('../fixtures/cashier-owner-register-inverse.json',import.meta.url),'utf8'));
export const cashierOwnerRegisterSha=source=>createHash('sha256').update(source).digest('hex');
export function restoreCashierOwnerRegister(source,file){
 source=normalizePlottedRelease(source,file);
 source=normalizeCashierReceivingProgress(source,file);
 const row=cashierOwnerRegisterProof.files[file];if(!row||cashierOwnerRegisterSha(source)===row.baselineSha256)return source;
 assert.equal(cashierOwnerRegisterSha(source),row.candidateSha256,'Only reviewed Owner register monitoring edits: '+file);
 for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Unique Owner register edit: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(cashierOwnerRegisterSha(source),row.baselineSha256);return source;
}
export const normalizeCashierOwnerRegister=(source,file)=>{source=normalizePlottedRelease(source,file);source=normalizeCashierReceivingProgress(source,file);return cashierOwnerRegisterProof.files[file]?.candidateSha256===cashierOwnerRegisterSha(source)?restoreCashierOwnerRegister(source,file):source;};
export function excludeCashierOwnerRegisterLeaf(file,read){const pin=cashierOwnerRegisterProof.newFiles[file];if(!pin)return false;assert.equal(cashierOwnerRegisterSha(read(file)),pin);return true;}
