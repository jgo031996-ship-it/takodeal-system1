import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const branchInventorySetupProof=JSON.parse(readFileSync(new URL('../fixtures/branch-inventory-setup-inverse.json',import.meta.url),'utf8'));
export const branchInventorySetupSha=value=>createHash('sha256').update(value).digest('hex');
export function restoreBranchInventorySetup(source,file){
 const row=branchInventorySetupProof.files[file];
 if(!row||branchInventorySetupSha(source)!==row.candidateSha256)return source;
 for(const edit of [...row.edits].reverse()){
  assert.equal(source.split(edit.after).length,2,'Unique branch inventory hunk: '+file);source=source.replace(edit.after,()=>edit.before);
 }
 assert.equal(branchInventorySetupSha(source),row.baselineSha256,'Every previous live product byte is retained: '+file);return source;
}
