import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const cashierOwnerWorkspaceProof=JSON.parse(readFileSync(new URL('../fixtures/cashier-owner-workspace-inverse.json',import.meta.url),'utf8'));
export const cashierOwnerWorkspaceSha=value=>createHash('sha256').update(value).digest('hex');
export function restoreCashierOwnerWorkspace(source,file){
 const row=cashierOwnerWorkspaceProof.files[file];if(!row||cashierOwnerWorkspaceSha(source)===row.baselineSha256)return source;
 assert.equal(cashierOwnerWorkspaceSha(source),row.candidateSha256,'Only the reviewed Owner workspace/delivery hunks: '+file);
 for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Unique Owner workspace hunk: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(cashierOwnerWorkspaceSha(source),row.baselineSha256,'Every other live af0 byte stays exact: '+file);return source;
}
export const normalizeCashierOwnerWorkspace=(source,file)=>cashierOwnerWorkspaceProof.files[file]?.candidateSha256===cashierOwnerWorkspaceSha(source)?restoreCashierOwnerWorkspace(source,file):source;
