import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restorePrepReviewIntegration} from './cashier-prep-review-inverse.mjs';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/cashier-void-integration.json',import.meta.url)));
export function restoreCashierVoidIntegration(source,file='Takodeal-POS/main.js'){
 source=restorePrepReviewIntegration(source,file);
 const record=fixture.files[file];assert.ok(record,'Only the reviewed Cashier integration files may be restored.');
 for(const edit of [...record.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Exact reviewed void hunk: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(createHash('sha256').update(source).digest('hex'),record.baselineSha256,'All other bytes stay at exact ef37: '+file);
 return source;
}
