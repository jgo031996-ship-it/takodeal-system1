import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const attendanceOvertimeProof=JSON.parse(readFileSync(new URL('../fixtures/attendance-overtime-inverse.json',import.meta.url),'utf8'));
export const overtimeSha=value=>createHash('sha256').update(value).digest('hex');
export function restoreAttendanceOvertime(source,file){
 const row=attendanceOvertimeProof.files[file];if(!row)return source;
 if(overtimeSha(source)===row.baselineSha256)return source;
 assert.equal(overtimeSha(source),row.candidateSha256,'Only the exact reviewed attendance OT changes may precede historical checks: '+file);
 for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Unique reviewed OT hunk: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(overtimeSha(source),row.baselineSha256,'Every earlier live byte is preserved: '+file);return source;
}
// Historical scopes keep their original allowlists. Remove only exact OT-only
// changes that restore to the actual Git byte content of that earlier base.
export function isHistoricalOwnerChange(file,base){
 if(!attendanceOvertimeProof.files[file]&&!attendanceOvertimeProof.newFiles[file])return true;
 const root=new URL('../../',import.meta.url),source=readFileSync(new URL(file,root),'utf8');
 if(attendanceOvertimeProof.newFiles[file]){assert.equal(overtimeSha(source),attendanceOvertimeProof.newFiles[file],file+' is the exact new OT module');return false;}
 const restored=restoreAttendanceOvertime(source,file),git=ref=>execFileSync('git',['show',ref+':'+file],{cwd:root,encoding:'utf8',maxBuffer:4e6,windowsHide:true});
 assert.equal(restored,git(attendanceOvertimeProof.base),'Exact live baseline after OT inverse: '+file);
 return restored!==git(base);
}
