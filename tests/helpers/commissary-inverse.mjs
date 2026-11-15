import {normalizePlottedRelease} from './plotted-release-inverse.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {normalizeManualAttendanceSimple} from './manual-attendance-simple-inverse.mjs';
export const commissaryProof=JSON.parse(readFileSync(new URL('../fixtures/commissary-inverse.json',import.meta.url),'utf8'));
export const commissarySha=v=>createHash('sha256').update(v).digest('hex');
export function restoreCommissary(source,file){
 source=normalizePlottedRelease(source,file);
 source=normalizeManualAttendanceSimple(source,file);
 const row=commissaryProof.files[file];if(!row||commissarySha(source)!==row.candidateSha256)return source;
 for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Exact commissary release hunk: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(commissarySha(source),row.baselineSha256,'All prior Owner bytes are preserved: '+file);return source;
}
export function isCommissaryModule(file){if(!Object.hasOwn(commissaryProof.newFiles,file))return false;assert.equal(commissarySha(readFileSync(new URL('../../'+file,import.meta.url),'utf8')),commissaryProof.newFiles[file],file+' is the reviewed module');return true;}
