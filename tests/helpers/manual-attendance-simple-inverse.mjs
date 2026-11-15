import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
export const manualAttendanceSimpleProof=JSON.parse(readFileSync(new URL('../fixtures/manual-attendance-simple-inverse.json',import.meta.url),'utf8'));
export const manualAttendanceSimpleSha=value=>createHash('sha256').update(value).digest('hex');
export function restoreManualAttendanceSimple(source,file){
 const row=manualAttendanceSimpleProof.files[file];if(!row||manualAttendanceSimpleSha(source)===row.baselineSha256)return source;
 assert.equal(manualAttendanceSimpleSha(source),row.candidateSha256,'Only the reviewed one-form Owner attendance changes: '+file);
 for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Unique Owner manual attendance hunk: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(manualAttendanceSimpleSha(source),row.baselineSha256,'Every prior Owner byte is preserved: '+file);return source;
}
// Only Owner UI files normalize through earlier Owner chains. Server files
// have their own separately pinned additive inverse and no implicit rewrite.
export const normalizeManualAttendanceSimple=(source,file)=>manualAttendanceSimpleProof.files[file]?.candidateSha256===manualAttendanceSimpleSha(source)?restoreManualAttendanceSimple(source,file):source;
export function restoreManualAttendanceBackend(source,file){
 const binding=manualAttendanceSimpleProof.backend,text=readFileSync(new URL('../'+binding.path.replace(/^tests\//,''),import.meta.url),'utf8');assert.equal(manualAttendanceSimpleSha(text),binding.sha256,'Exact separately reviewed backend proof');
 const proof=JSON.parse(text);assert.equal(proof.baseCommit,manualAttendanceSimpleProof.base);const row=proof.runtimeFiles.find(row=>row.path===file);assert.ok(row,'Only the two named backend leaves');assert.equal(manualAttendanceSimpleSha(source),row.sha256);
 for(const edit of row.inverse){assert.equal(source.split(edit.from).length,2);source=source.replace(edit.from,()=>edit.to);}assert.equal(manualAttendanceSimpleSha(source),row.baseSha256);return source;
}
export function isHistoricalManualAttendanceChange(file,base){
 const row=manualAttendanceSimpleProof.files[file],backend=manualAttendanceSimpleProof.backend.files.find(row=>row.path===file);if(!row&&!backend)return true;
 const root=new URL('../../',import.meta.url),source=readFileSync(new URL(file,root),'utf8'),restored=row?restoreManualAttendanceSimple(source,file):restoreManualAttendanceBackend(source,file),git=ref=>execFileSync('git',['show',ref+':'+file],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:5e6});
 assert.equal(restored,git(manualAttendanceSimpleProof.base),'Exact live afade source before historical scope: '+file);
 try{return restored!==git(base);}catch(error){if(String(error.stderr||'').includes('does not exist')||String(error.stderr||'').includes('exists on disk, but not in'))return true;throw error;}
}
