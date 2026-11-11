import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreOwnerStockWarnings} from './owner-stock-warnings-inverse.mjs';
export const ownerPrepRecoveryReleaseProof=JSON.parse(readFileSync(new URL('../fixtures/owner-prep-recovery-release-inverse.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
export function restoreOwnerPrepRecoveryRelease(path,source){
 source=restoreOwnerStockWarnings(path,source);
 const proof=ownerPrepRecoveryReleaseProof.files[path];if(!proof)return source;
 assert.equal(sha(source),proof.candidateSha256,'Exact Owner prep recovery release source: '+path);
 let restored=source;for(const{before,after}of[...proof.edits].reverse()){assert.equal(restored.split(after).length,2,'Exact release-only hunk: '+path);restored=restored.replace(after,before);}
 assert.equal(sha(restored),proof.baselineSha256,'Every prior release byte is retained: '+path);return restored;
}
