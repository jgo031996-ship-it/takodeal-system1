import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {lowerFirestorePaths,assertPathLoweringEquivalent} from '../tools/firestore-selector-sharing/document-paths.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const wrap=body=>"rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { "+body+' } }';
const changedProof=(proof,source)=>({...proof,loweredSha256:hash(source)});
test('the actual frozen policy lowers all95 paths, including eight deep staff-document paths, and independently reverses exactly',()=>{
 const original=fs.readFileSync(new URL('../firestore.policy.rules',import.meta.url),'utf8'),result=lowerFirestorePaths(original);
 assert.equal(result.proof.calls,95);assert.deepEqual(result.proof.depths,{2:87,4:8});
 assert.equal(result.proof.originalSha256,'07984b3918a763e7538ff13784b31367a40142f36059496f580780c989e4e4a1');
 assert.equal(assertPathLoweringEquivalent(original,result.source,result.proof).allOtherBytesExact,true);
});
test('already shared document readers can retain inline paths with an exact inverse and no added selector frame',()=>{
 const first='function readData(collection,id) { return get(/databases/$(database)/documents/$(collection)/$(id)).data; }',second='function subject(id) { return exists(/databases/$(database)/documents/items/$(id)); }',original=wrap(first+second),result=lowerFirestorePaths(original,{excludedFunctions:['readData']});
 assert.equal(result.proof.calls,1);assert.equal(result.proof.inlinePaths,1);assert.deepEqual(result.proof.excludedFunctions,['readData']);assert.ok(result.source.includes(first));assert.match(result.source,/exists\(tkPath2\('items',\(id\)\)\)/);assert.equal(assertPathLoweringEquivalent(original,result.source,result.proof,{returnSource:true}),original);
});
test('a wholly inline policy remains exact and no unused path helper is introduced',()=>{
 const original=wrap('function readData(id) { return get(/databases/$(database)/documents/items/$(id)).data; }'),result=lowerFirestorePaths(original,{excludedFunctions:['readData']});assert.equal(result.proof.calls,0);assert.equal(result.proof.inlinePaths,1);assert.deepEqual(result.proof.selectors,[]);assert.equal(assertPathLoweringEquivalent(original,result.source,result.proof,{returnSource:true}),original);assert.doesNotMatch(result.source,/function tkPath/);
});
test('path exclusions accept only unique function identifiers and tampering cannot hide a selected occurrence',()=>{
 const original=wrap('function readData(id) { return get(/databases/$(database)/documents/items/$(id)).data; } function subject(id) { return exists(/databases/$(database)/documents/items/$(id)); }');
 for(const excludedFunctions of [null,'readData',['readData','readData'],['readData()'],[12]])assert.throws(()=>lowerFirestorePaths(original,{excludedFunctions}),/unique identifiers/);
 const result=lowerFirestorePaths(original,{excludedFunctions:['readData']});assert.throws(()=>assertPathLoweringEquivalent(original,result.source,{...result.proof,excludedFunctions:[]}),/count changed/);assert.throws(()=>assertPathLoweringEquivalent(original,result.source,{...result.proof,excludedFunctions:['readData','subject']}),/count changed/);assert.throws(()=>assertPathLoweringEquivalent(original,result.source,{...result.proof,inlinePaths:2}),/inline|count changed/);const altered=result.source.replace("tkPath2('items',(id))","tkPath2('other',(id))");assert.throws(()=>assertPathLoweringEquivalent(original,altered,changedProof(result.proof,altered)),/reconstruction/);
});
test('selectors cover two, four and six segments with no more than six arguments',()=>{
 const original=wrap('function f(id,x,y) { return exists(/databases/$(database)/documents/a/$(id)) && exists(/databases/$(database)/documents/a/$(id)/b/$(x)) && exists(/databases/$(database)/documents/a/$(id)/b/$(x)/c/$(y)); }');
 const {source,proof}=lowerFirestorePaths(original);assert.deepEqual(proof.depths,{2:1,4:1,6:1});
 assert.deepEqual(proof.selectors.map(row=>row.parameters.length),[2,4,6]);assert.match(source,/tkPath6\('a',\(id\),'b',\(x\),'c',\(y\)\)/);
});
test('nested paths inside an ID expression lower inside-out and both expressions reconstruct exactly',()=>{
 const original=wrap('function f(id) { return exists(/databases/$(database)/documents/a/$(get(/databases/$(database)/documents/b/$(id)).data.target)); }');
 const result=lowerFirestorePaths(original);assert.equal(result.proof.calls,2);assert.match(result.source,/tkPath2\('a',\(get\(tkPath2\('b',\(id\)\)\)/);
 assert.equal(assertPathLoweringEquivalent(original,result.source,result.proof).pathsVerified,2);
});
test('strings and comments that resemble paths are untouched',()=>{
 const opaque="// /databases/$(database)/documents/fake/$(id)\nfunction f(id) { let note = '/databases/$(database)/documents/fake/$(id)'; return exists(/databases/$(database)/documents/real/$(id)); }";
 const {source,proof}=lowerFirestorePaths(wrap(opaque));assert.equal(proof.calls,1);assert.ok(source.includes("let note = '/databases/$(database)/documents/fake/$(id)'"));assert.ok(source.includes('// /databases/$(database)/documents/fake/$(id)'));
});
test('static hyphenated and numeric path segments retain their exact text',()=>{
 const original=wrap('function f(id) { return exists(/databases/$(database)/documents/raw-segment/$(id)) && exists(/databases/$(database)/documents/archive/20261031); }');
 const result=lowerFirestorePaths(original);assert.equal(result.proof.calls,2);assert.match(result.source,/tkPath2\('raw-segment',\(id\)\)/);assert.match(result.source,/tkPath2\('archive','20261031'\)/);
});
test('dynamic literal-string segments remain distinguishable from static segments',()=>{
 const original=wrap("function f() { return exists(/databases/$(database)/documents/$('a')/current); }");
 const result=lowerFirestorePaths(original);assert.match(result.source,/tkPath2\(\('a'\),'current'\)/);assert.equal(assertPathLoweringEquivalent(original,result.source,result.proof).allOtherBytesExact,true);
});
test('dynamic expressions preserve original order, parentheses, whitespace and comments',()=>{
 const original=wrap('function f(flag) { return exists(/databases/$(database)/documents/$(first())/$( flag ? second(/* original */) : third() )); }');
 const result=lowerFirestorePaths(original);assert.ok(result.source.includes('tkPath2((first()),( flag ? second(/* original */) : third() ))'));
 assert.equal(assertPathLoweringEquivalent(original,result.source,result.proof).originalSegmentEvaluationOrder,true);
});
test('fresh helper and parameter names cannot capture source identifiers',()=>{
 const original=wrap('function tkPath2(tkPathSegment2_0) { return exists(/databases/$(database)/documents/a/$(tkPathSegment2_0)); }');
 const result=lowerFirestorePaths(original);assert.equal(result.proof.selectors[0].name,'tkPath21');assert.notEqual(result.proof.selectors[0].parameters[0],'tkPathSegment2_0');
});
test('a database parameter, local binding or nested match capture is refused',()=>{
 for(const body of [
  'function f(database,id) { return exists(/databases/$(database)/documents/a/$(id)); }',
  'function f(id) { let database = id; return exists(/databases/$(database)/documents/a/$(id)); }',
  'match /other/{database} { allow read: if exists(/databases/$(database)/documents/a/current); }'
 ])assert.throws(()=>lowerFirestorePaths(wrap(body)),/shadows database/);
});
test('deceptive prefix spacing, interpolation suffixes and unsupported dotted segments fail closed',()=>{
 for(const path of [
  '/databases /$(database)/documents/a/$(id)',
  '/databases/$(database)/documents/a/$(id)-suffix',
  '/databases/$(database)/documents/a.b/$(id)',
  '/databases/$(database)/documents/a/prefix$(id)',
  '/databases/$(database)/documents/a/$(id) / extra'
 ])assert.throws(()=>lowerFirestorePaths(wrap('function f(id) { return exists('+path+'); }')),/ambiguous|unsupported/);
});
test('a division expression resembling a canonical prefix is not rewritten as a path',()=>{
 assert.throws(()=>lowerFirestorePaths(wrap('function f(x,id) { return x /databases/$(database)/documents/a/$(id); }')),/not in a path-expression position/);
});
test('incomplete or more-than-six-segment document paths are refused rather than partially replaced',()=>{
 for(const path of ['/databases/$(database)/documents/a','/databases/$(database)/documents/a/b/c','/databases/$(database)/documents/a/b/c/d/e/f/g/h'])assert.throws(()=>lowerFirestorePaths(wrap('function f() { return exists('+path+'); }')),/two, four or six/);
});
test('non-data paths and match patterns retain every byte',()=>{
 const original=wrap('match /other/{id} { allow read: if exists(/other/path) && exists(/databases/$(database)/documents/a/$(id)); }');
 const result=lowerFirestorePaths(original);assert.ok(result.source.includes('match /other/{id}'));assert.ok(result.source.includes('exists(/other/path)'));assert.equal(result.proof.calls,1);
});
test('the independent proof rejects selector-body and predicate changes even if the supplied output hash is updated',()=>{
 const original=wrap('function f(id) { return exists(/databases/$(database)/documents/a/$(id)); }'),result=lowerFirestorePaths(original);
 const body=result.source.replace('documents/$(tkPathSegment2_0)','documents/WRONG');
 assert.throws(()=>assertPathLoweringEquivalent(original,body,changedProof(result.proof,body)),/selector bodies|placement/);
 const predicate=result.source.replace('return exists(','return !exists(');
 assert.throws(()=>assertPathLoweringEquivalent(original,predicate,changedProof(result.proof,predicate)),/another source byte/);
});
test('the independent proof rejects reordered ID expressions, changed static names, missing parentheses or altered arity',()=>{
 const original=wrap('function f(a,b) { return exists(/databases/$(database)/documents/$(a)/$(b)); }'),result=lowerFirestorePaths(original);
 for(const [from,to]of [['tkPath2((a),(b))','tkPath2((b),(a))'],['tkPath2((a),(b))',"tkPath2('wrong',(b))"],['tkPath2((a),(b))','tkPath2(a,(b))'],['tkPath2((a),(b))','tkPath2((a))']]){
  const changed=result.source.replace(from,to);assert.notEqual(changed,result.source);assert.throws(()=>assertPathLoweringEquivalent(original,changed,changedProof(result.proof,changed)),/another source byte|parentheses|arity/);
 }
});
