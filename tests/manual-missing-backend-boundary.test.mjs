import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const proof=JSON.parse(readFileSync(new URL('./fixtures/manual-missing-backend-inverse.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
assert.equal(proof.baseCommit,'afade4cf34d99f7e0983cd751eaffd4dd66120ae');
assert.deepEqual(proof.runtimeFiles.map(row=>row.path),['functions/cash-remittance-review/owner-time-out-handler.mjs','functions/cash-remittance-review/owner-time-out-service.mjs']);
for(const file of proof.runtimeFiles)test('manual-only additions invert exactly to the published '+file.path,()=>{
 let current=readFileSync(new URL('../'+file.path,import.meta.url),'utf8');
 assert.equal(sha(current),file.sha256);
 for(const change of file.inverse){assert.equal(current.split(change.from).length-1,1,'Each approved addition must occur exactly once');current=current.replace(change.from,change.to);}
 assert.equal(sha(current),file.baseSha256,'Ordinary corrections, request approvals and financial/source guards must retain their exact baseline bytes');
});
