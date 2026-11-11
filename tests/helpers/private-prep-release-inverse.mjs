import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreOwnerPrepRecoveryRelease} from './owner-prep-recovery-release-inverse.mjs';
export const privatePrepReleaseProof=JSON.parse(readFileSync(new URL('../fixtures/private-prep-release-inverse.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
export function restorePrivatePrepRelease(path,source){source=restoreOwnerPrepRecoveryRelease(path,source);const proof=privatePrepReleaseProof.files[path];assert.ok(proof,'Only reviewed Owner release paths have an inverse');assert.equal(sha(source),proof.candidateSha256,'Exact private-prep source candidate: '+path);let restored=source;for(const{before,after}of[...proof.edits].reverse()){assert.equal(restored.split(after).length,2,'Exact private-prep hunk: '+path);restored=restored.replace(after,before);}assert.equal(sha(restored),proof.baselineSha256,'Every original Owner byte remains after removing the reviewed feature');return restored;}
