import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const proof=JSON.parse(readFileSync(new URL('../fixtures/staff-personal-vault-inverse.json',import.meta.url),'utf8'));
export const sha=value=>createHash('sha256').update(value).digest('hex');
export function restoreStaffPersonalVault(source,file){
 const row=proof.files[file];if(!row||sha(source)!==row.candidateSha256)return source;
 for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Unique reviewed hunk: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(sha(source),row.baselineSha256,'Earlier live source remains exact: '+file);return source;
}
