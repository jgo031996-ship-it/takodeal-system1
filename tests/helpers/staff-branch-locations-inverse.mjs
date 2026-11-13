import {restoreLiveBranchDirectory} from './live-branch-directory-inverse.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const staffBranchLocationsProof=JSON.parse(readFileSync(new URL('../fixtures/staff-branch-locations-inverse.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
export function restoreStaffBranchLocations(source,file) {
    const row=staffBranchLocationsProof.files[file];if(row&&sha(source)===row.baselineSha256)return source;source=restoreLiveBranchDirectory(source,file);if(!row||sha(source)===row.baselineSha256)return source;
    assert.equal(sha(source),row.candidateSha256,'Only the reviewed Staff branch-location hunks: '+file);
    for(const edit of [...row.edits].reverse()) {
        assert.equal(source.split(edit.after).length,2,'Unique Staff branch-location hunk: '+file);
        source=source.replace(edit.after,()=>edit.before);
    }
    assert.equal(sha(source),row.baselineSha256,'Every other live Staff byte remains exact: '+file);
    return source;
}
