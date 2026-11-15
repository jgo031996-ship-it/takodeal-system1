import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
export const simpleVoidProof=JSON.parse(readFileSync(new URL('../fixtures/cashier-simple-void-inverse.json',import.meta.url),'utf8'));
export const simpleVoidSha=source=>createHash('sha256').update(source).digest('hex');
export function restoreSimpleVoid(source,file){
 const row=simpleVoidProof.files[file];if(!row||simpleVoidSha(source)===row.baselineSha256)return source;
 assert.equal(simpleVoidSha(source),row.candidateSha256,'Only reviewed simple void workflow edits: '+file);
 for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Unique simple void edit: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(simpleVoidSha(source),row.baselineSha256);return source;
}
export const normalizeSimpleVoid=(source,file)=>simpleVoidProof.files[file]?.candidateSha256===simpleVoidSha(source)?restoreSimpleVoid(source,file):source;
export const legacyVoidSource=(source,file)=>['Takodeal-POS/cashier-void.js','Takodeal-POS/cashier-void-access.js'].includes(file)?normalizeSimpleVoid(source,file):source;
export function simpleVoidOnlyChange(file,read,baseline){if(!simpleVoidProof.files[file])return false;const restored=normalizeSimpleVoid(read(file),file);return restored===baseline();}
