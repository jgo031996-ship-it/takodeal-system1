import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const cuts=JSON.parse(readFileSync(new URL('../fixtures/inventory-security-policy-cuts.json',import.meta.url),'utf8')),sha=x=>createHash('sha256').update(x).digest('hex');
export function restoreInventoryAliases(input){
 if([cuts.beforeHash,cuts.intermediateHash].includes(sha(input)))return input;assert.equal(sha(input),cuts.afterHash,'Exact inventory security candidate');let source=input;
 for(const stage of [...cuts.secondaryAliases].reverse()){assert.equal(sha(source),stage.afterHash);for(const edit of [...stage.edits].reverse()){assert.equal(source.slice(edit.at,edit.at+edit.after.length),edit.after);source=source.slice(0,edit.at)+edit.before+source.slice(edit.at+edit.after.length);}assert.equal(sha(source),stage.beforeHash);}
 for(const edit of [...cuts.alias.edits].reverse()){assert.equal(source.slice(edit.at,edit.at+edit.after.length),edit.after);source=source.slice(0,edit.at)+edit.before+source.slice(edit.at+edit.after.length);}assert.equal(sha(source),cuts.intermediateHash);
 return source;
}
export function restoreInventorySecurityStage(input){
 if(sha(input)===cuts.beforeHash)return input;let source=restoreInventoryAliases(input);
 for(const edit of [...cuts.edits].reverse()){const at=source.indexOf(edit.after);assert.notEqual(at,-1);assert.equal(at,source.lastIndexOf(edit.after),'Unique authority cut');source=source.slice(0,at)+edit.before+source.slice(at+edit.after.length);}assert.equal(sha(source),cuts.beforeHash,'Every unrelated policy byte retained');return source;
}
