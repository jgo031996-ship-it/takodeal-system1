import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreLargeDeliveryStatus} from './large-delivery-status-inverse.mjs';
export const liveBranchDirectoryProof=JSON.parse(readFileSync(new URL('../fixtures/live-branch-directory-inverse.json',import.meta.url),'utf8'));
export const liveBranchSha=value=>createHash('sha256').update(value).digest('hex');
export function restoreLiveBranchDirectory(source,file) {
    source=restoreLargeDeliveryStatus(source,file);
    const row=liveBranchDirectoryProof.files[file];if(!row||liveBranchSha(source)===row.baselineSha256)return source;
    assert.equal(liveBranchSha(source),row.candidateSha256,'Only the reviewed automatic branch hooks: '+file);
    for(const edit of [...row.edits].reverse()) {assert.equal(source.split(edit.after).length,2,'Unique live branch hunk: '+file);source=source.replace(edit.after,()=>edit.before);}
    assert.equal(liveBranchSha(source),row.baselineSha256,'Every other live app byte remains exact: '+file);return source;
}
