import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreLargeDeliveryStatus} from './large-delivery-status-inverse.mjs';
export const ownerDeliveryProof=JSON.parse(readFileSync(new URL('../fixtures/owner-delivery-upgrade-inverse.json',import.meta.url),'utf8'));
export const ownerDeliverySha=value=>createHash('sha256').update(value).digest('hex');
export function restoreOwnerDeliveryUpgrade(source,file){
 source=restoreLargeDeliveryStatus(source,file);
 const row=ownerDeliveryProof.files[file];if(!row||ownerDeliverySha(source)===row.baselineSha256)return source;
 assert.equal(ownerDeliverySha(source),row.candidateSha256,'Only the reviewed delivery radar and inventory edits: '+file);
 for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Unique delivery upgrade hunk: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(ownerDeliverySha(source),row.baselineSha256,'Every earlier live byte is retained: '+file);return source;
}
