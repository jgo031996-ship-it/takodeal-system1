import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const branchSettingsSaveProof=JSON.parse(readFileSync(new URL('../fixtures/branch-settings-save-inverse.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
export function restoreBranchSettingsSave(file,source) {
    const row=branchSettingsSaveProof.files[file];
    if(!row||sha(source)===row.baselineSha256)return source;
    assert.equal(sha(source),row.candidateSha256,'Only the reviewed branch-settings fix may change: '+file);
    for(const edit of [...row.edits].reverse()) {
        assert.equal(source.split(edit.after).length,2,'Unique branch-settings hunk: '+file);
        source=source.replace(edit.after,()=>edit.before);
    }
    assert.equal(sha(source),row.baselineSha256,'Every other live Owner byte stays exact: '+file);
    return source;
}
