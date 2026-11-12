import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {restoreOwnerPrepYield} from './owner-prep-yield-inverse.mjs';
export const ownerStockWarningsProof=JSON.parse(readFileSync(new URL('../fixtures/owner-stock-warnings-inverse.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
export function restoreOwnerStockWarnings(file,source){source=restoreOwnerPrepYield(file,source);const row=ownerStockWarningsProof.files[file];if(!row)return source;assert.equal(sha(source),row.candidateSha256,'Only the reviewed posted-warning integration may change: '+file);for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Unique posted-warning hunk: '+file);source=source.replace(edit.after,()=>edit.before);}assert.equal(sha(source),row.baselineSha256,'Every unrelated live Owner byte remains unchanged: '+file);return source;}
