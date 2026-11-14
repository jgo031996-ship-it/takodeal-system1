import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const largeDeliveryProof=JSON.parse(readFileSync(new URL('../fixtures/large-delivery-status-inverse.json',import.meta.url),'utf8'));
export const largeDeliverySha=value=>createHash('sha256').update(value).digest('hex');
export function restoreLargeDeliveryStatus(source,file){
    const row=largeDeliveryProof.files[file];if(!row||largeDeliverySha(source)!==row.candidateSha256)return source;
    for(const edit of [...row.edits].reverse()){
        assert.equal(source.split(edit.after).length,2,'Unique large delivery hunk: '+file);
        source=source.replace(edit.after,()=>edit.before);
    }
    assert.equal(largeDeliverySha(source),row.baselineSha256,'Earlier live source remains exact: '+file);
    return source;
}
