import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{createHash}from'node:crypto';
import{lowerLiteralFalseRules,assertLiteralFalseLoweringEquivalent}from'../tools/firestore-selector-sharing/literal-false-rules.mjs';
const wrap=body=>"rules_version='2'; service cloud.firestore { match /databases/{database}/documents { "+body+' } }';
const hash=value=>createHash('sha256').update(value).digest('hex');
test('actual policy removes only complete literal-false statements and retains all other bytes by strict independent replay',()=>{
 const original=fs.readFileSync(new URL('../firestore.policy.rules',import.meta.url),'utf8'),result=lowerLiteralFalseRules(original);
 assert.equal(result.statistics.literalFalseAllows,41);assert.equal(assertLiteralFalseLoweringEquivalent(original,result.source,result.proof).noTrueOrConditionalGrantRemoved,true);
});
test('all known method lists are allowed and true or conditional expressions survive byte-exact',()=>{
 const body='match /x/{id} { allow get,list,create,update,delete: if false; allow read,write: if false; allow read: if true; allow update: if false && allowed(); allow delete: if false || true; allow create: if (false); }',original=wrap(body),result=lowerLiteralFalseRules(original);
 assert.equal(result.statistics.literalFalseAllows,2);for(const text of ['allow read: if true;','allow update: if false && allowed();','allow delete: if false || true;','allow create: if (false);'])assert.ok(result.source.includes(text));
});
test('false-looking strings and comments never become statements',()=>{
 const original=wrap('function f() { return "allow read: if false;"; } /* allow write: if false; */ match /x/{id} { allow read: if true; }');
 const result=lowerLiteralFalseRules(original);assert.equal(result.statistics.literalFalseAllows,0);assert.equal(result.source,original);
});
test('inline and line comments inside removed statements remain intact',()=>{
 const original=wrap('match /x/{id} { allow /* keep method */ read: // keep condition\n if false; /* keep after */ }'),result=lowerLiteralFalseRules(original);
 assert.equal(result.statistics.literalFalseAllows,1);assert.equal(result.statistics.emptyMatches,1);for(const text of ['/* keep method */','// keep condition','/* keep after */'])assert.ok(result.source.includes(text));
});
test('only truly empty matches are pruned; functions, surviving grants and child scopes protect their parent',()=>{
 const original=wrap('match /empty/{id} {} match /comments/{id} { /* comment */ } match /f/{id} { function keep() { return false; } } match /grant/{id} { allow read: if true; } match /parent/{id} { match /child/{key} { allow read: if true; } }'),result=lowerLiteralFalseRules(original);
 assert.equal(result.statistics.emptyMatches,2);assert.ok(result.source.includes('match /f/{id}'));assert.ok(result.source.includes('match /parent/{id}'));assert.ok(result.source.includes('match /child/{key}'));assert.ok(result.source.includes('function keep()'));
});
test('nested empty-only child and parent scopes prune without moving a surviving declaration',()=>{
 const original=wrap('match /parent/{id} { /* p */ match /child/{key} { /* c */ allow write: if false; } }'),result=lowerLiteralFalseRules(original);
 assert.equal(result.statistics.emptyMatches,2);assert.ok(result.source.includes('/* p */'));assert.ok(result.source.includes('/* c */'));assert.ok(result.source.includes('match /databases/{database}/documents'));
});
test('unknown or malformed method lists cannot be silently deleted',()=>{
 const original=wrap('match /x/{id} { allow unknown: if false; allow read,: if false; allow read,read: if false; allow read: if false ? true : false; }'),result=lowerLiteralFalseRules(original);
 assert.equal(result.statistics.literalFalseAllows,0);assert.equal(result.statistics.emptyMatches,0);assert.equal(result.source,original);
});
test('independent replay rejects deleting true, conditional false, a function-bearing match or any other text',()=>{
 for(const statement of ['allow read: if true;','allow read: if false || true;','function f() { return false; }']){
  const original=wrap('match /x/{id} { '+statement+' }'),base=lowerLiteralFalseRules(original),at=original.indexOf(statement),out=original.slice(0,at)+original.slice(at+statement.length),proof={...base.proof,loweredSha256:hash(out),operations:[{kind:'literal-false-allow',start:at,end:at+statement.length,original:statement,replacement:''}]};
  assert.throws(()=>assertLiteralFalseLoweringEquivalent(original,out,proof),/not a complete/);
 }
});
test('remaining grant OR and default-deny truth tables are unchanged',()=>{
 for(let mask=0;mask<8;mask++){const remaining=[Boolean(mask&1),Boolean(mask&2),Boolean(mask&4)];assert.equal([false,...remaining,false].some(Boolean),remaining.some(Boolean));}assert.equal([false,false].some(Boolean),[].some(Boolean));
});
