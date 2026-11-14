import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const staffPhoneHelpProof=JSON.parse(readFileSync(new URL('../fixtures/staff-phone-help-inverse.json',import.meta.url),'utf8'));
export const staffPhoneHelpSha=source=>createHash('sha256').update(source).digest('hex');
export function restoreStaffPhoneHelp(source,file){
    const row=staffPhoneHelpProof.files[file];if(!row||staffPhoneHelpSha(source)!==row.candidateSha256)return source;
    for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Unique Staff phone help hunk: '+file);source=source.replace(edit.after,()=>edit.before);}
    assert.equal(staffPhoneHelpSha(source),row.baselineSha256,'Earlier Staff release remains exact: '+file);return source;
}
