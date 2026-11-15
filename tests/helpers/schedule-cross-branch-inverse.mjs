import {normalizePlottedRelease} from './plotted-release-inverse.mjs';
import {restoreBranchInventorySetup} from './branch-inventory-setup-inverse.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const scheduleCrossBranchProof=JSON.parse(readFileSync(new URL('../fixtures/schedule-cross-branch-inverse.json',import.meta.url),'utf8'));
export const scheduleCrossBranchSha=value=>createHash('sha256').update(value).digest('hex');
// Older release checks can examine their original reviewed bytes after this
// exact, separately reviewed schedule layer is removed. Never normalize edits.
export function restoreScheduleCrossBranch(source,file){
 source=normalizePlottedRelease(source,file);
 source=restoreBranchInventorySetup(source,file);
 const row=scheduleCrossBranchProof.files[file];
 if(!row||scheduleCrossBranchSha(source)!==row.candidateSha256)return source;
 for(const edit of [...row.edits].reverse()){
  assert.equal(source.split(edit.after).length,2,'Unique schedule hunk: '+file);
  source=source.replace(edit.after,()=>edit.before);
 }
 assert.equal(scheduleCrossBranchSha(source),row.baselineSha256,'Preserved live Owner bytes: '+file);
 return source;
}
