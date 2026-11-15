import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {commissaryProof as proof,commissarySha as sha,restoreCommissary} from './helpers/commissary-inverse.mjs';
import {normalizeManualAttendanceSimple,isHistoricalManualAttendanceChange} from './helpers/manual-attendance-simple-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>normalizeManualAttendanceSimple(readFileSync(new URL(file,root),'utf8'),file),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:5e6});
test('commissary release preserves every existing business module and changes only four Owner entry files plus its new modules',()=>{
 const scope=['takodeal-manager','Takodeal-POS','takodeal-staff','Customer','takodeal-franchise','takodeal-delivery','functions','firestore.rules','firestore.policy.rules','storage.rules'];
 const paths=new Set([...git('diff','--name-only',proof.base,'--',...scope).trim().split('\n'),...git('ls-files','--others','--exclude-standard','--',...scope).trim().split('\n')].filter(Boolean));
 assert.deepEqual([...paths].filter(file=>isHistoricalManualAttendanceChange(file,proof.base)).sort(),[...Object.keys(proof.files),...Object.keys(proof.newFiles)].sort());
 for(const [file,row]of Object.entries(proof.files)){assert.equal(sha(read(file)),row.candidateSha256);assert.equal(restoreCommissary(read(file),file),git('show',proof.base+':'+file));assert.notEqual(restoreCommissary(read(file)+'\n// extra edit',file),git('show',proof.base+':'+file));}
 for(const [file,expected]of Object.entries(proof.newFiles))assert.equal(sha(read(file)),expected);
});
