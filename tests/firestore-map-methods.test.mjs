import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash}from'node:crypto';
import {lowerFirestoreMapMethods,assertMapMethodLoweringEquivalent}from'../tools/firestore-selector-sharing/map-methods.mjs';
const wrap=body=>"rules_version='2'; service cloud.firestore { match /databases/{database}/documents { "+body+' } }';
const hash=value=>createHash('sha256').update(value).digest('hex'),changed=(proof,source)=>({...proof,loweredSha256:hash(source)});
test('actual frozen policy factors116 eligible chains and independently restores every original byte',()=>{
 const original=fs.readFileSync(new URL('../firestore.policy.rules',import.meta.url),'utf8'),result=lowerFirestoreMapMethods(original);
 assert.equal(result.proof.calls,116);assert.deepEqual(result.proof.counts,{affectedKeys:58,changedKeys:1,addedKeys:1,removedKeys:1,keysOnly:58});
 assert.equal(assertMapMethodLoweringEquivalent(original,result.source,result.proof).allOtherBytesExact,true);
});
test('shared per-row validators retain their original inline map checks without an extra selector call',()=>{
 const shared='function cashShortagePayrollRow(item) { return item.keys().hasOnly(["id","amount"]); }',other='function subject(data) { return data.keys().hasOnly(["id","amount"]); }',original=wrap(shared+other),result=lowerFirestoreMapMethods(original,{minimumUses:1,excludedFunctions:['cashShortagePayrollRow']});
 assert.equal(result.proof.calls,1);assert.equal(result.proof.inlineChains,1);assert.deepEqual(result.proof.excludedFunctions,['cashShortagePayrollRow']);assert.ok(result.source.includes(shared));assert.match(result.source,/tkMapKeysOnly\(\(data\),\(\["id","amount"\]\)\)/);assert.equal(assertMapMethodLoweringEquivalent(original,result.source,result.proof,{returnSource:true}),original);
});
test('excluding every eligible map chain does not leave an unused selector declaration',()=>{
 const original=wrap('function subject(data,before) { return data.keys().hasOnly(["id"]) && data.diff(before).affectedKeys().size()>0; }'),result=lowerFirestoreMapMethods(original,{minimumUses:1,excludedFunctions:['subject']});assert.equal(result.proof.calls,0);assert.equal(result.proof.inlineChains,2);assert.deepEqual(result.proof.selectors,[]);assert.doesNotMatch(result.source,/function tkMap/);assert.equal(assertMapMethodLoweringEquivalent(original,result.source,result.proof,{returnSource:true}),original);
});
test('map exclusions are unique function identifiers and proof tampering cannot conceal an inline or transformed chain',()=>{
 const original=wrap('function shared(data) { return data.keys().hasOnly(["id"]); } function subject(data) { return data.keys().hasOnly(["id"]); }');
 for(const excludedFunctions of [null,'shared',['shared','shared'],['shared()'],[12]])assert.throws(()=>lowerFirestoreMapMethods(original,{excludedFunctions}),/unique identifiers/);
 const result=lowerFirestoreMapMethods(original,{minimumUses:1,excludedFunctions:['shared']});assert.throws(()=>assertMapMethodLoweringEquivalent(original,result.source,{...result.proof,excludedFunctions:[]}),/count changed/);assert.throws(()=>assertMapMethodLoweringEquivalent(original,result.source,{...result.proof,inlineChains:0}),/count changed/);const altered=result.source.replace('shared(data) { return data.keys().hasOnly(["id"])','shared(data) { return data.keys().hasOnly(["other"])');assert.notEqual(altered,result.source);assert.throws(()=>assertMapMethodLoweringEquivalent(original,altered,changed(result.proof,altered)),/source byte/);
});
test('all four diff result methods preserve exact method names, argument order and following Set operations',()=>{
 const original=wrap('function f(after,before) { return after.diff(before).affectedKeys().hasOnly(["a"]) && after.diff(before).changedKeys().size()>0 && after.diff(before).addedKeys().size()>0 && after.diff(before).removedKeys().size()>0; }');
 const result=lowerFirestoreMapMethods(original,{minimumUses:1});assert.equal(result.proof.calls,4);assert.equal(result.proof.selectors.length,4);assert.match(result.source,/tkMapAffectedKeys\(\(after\),\(before\)\)\.hasOnly/);
});
test('simple field operands and pinned oldData/newData getters retain their original expressions once',()=>{
 const original=wrap('function newData() { return request.resource.data; } function oldData() { return resource.data; } function f(a,b) { return a.payload.diff(b.payload).affectedKeys().size()>0 && newData().diff(oldData()).affectedKeys().size()>0; }');
 const result=lowerFirestoreMapMethods(original);assert.equal(result.proof.calls,2);assert.ok(result.source.includes('((a.payload),(b.payload))'));assert.ok(result.source.includes('((newData()),(oldData()))'));
});
test('a let binding is eligible only after its initializer has finished',()=>{
 const original=wrap('function f(before) { let later = later.diff(before).affectedKeys(); let after = before; return after.diff(before).affectedKeys().size()>0; }');
 const result=lowerFirestoreMapMethods(original,{minimumUses:1});assert.equal(result.proof.calls,1);assert.ok(result.source.includes('let later = later.diff(before).affectedKeys()'));
});
test('keysOnly accepts literal strings and pinned pure constant getters but leaves dynamic/read-dependent lists untouched',()=>{
 const original=wrap('function allowed() { return ["a","b"]; } function unsafe() { return get(/other/path).data.fields; } function f(data,fields) { return data.keys().hasOnly(["a"]) && data.keys().hasOnly(allowed()) && data.keys().hasOnly(fields) && data.keys().hasOnly(unsafe()); }');
 const result=lowerFirestoreMapMethods(original);assert.equal(result.proof.calls,2);assert.ok(result.source.includes('data.keys().hasOnly(fields)'));assert.ok(result.source.includes('data.keys().hasOnly(unsafe())'));
});
test('no document read or arbitrary function evaluation is hoisted into a diff selector',()=>{
 const original=wrap('function f(data,before) { return get(/other/path).data.diff(before).affectedKeys().size()>0 && data.diff(get(/other/path).data).affectedKeys().size()>0 && makeMap().keys().hasOnly(["a"]); }');
 const result=lowerFirestoreMapMethods(original);assert.equal(result.proof.calls,0);assert.ok(result.source.includes('get(/other/path).data.diff(before)'));assert.ok(result.source.includes('data.diff(get(/other/path).data)'));
});
test('nontransparent newData helper is never treated as a free data getter',()=>{
 const original=wrap('function newData() { return get(/other/path).data; } function f(before) { return newData().diff(before).affectedKeys().size()>0; }');
 const result=lowerFirestoreMapMethods(original,{minimumUses:1});assert.equal(result.proof.calls,0);
});
test('comments, string values and noncanonical spaced chains remain unchanged',()=>{
 const original=wrap('function f(a,b) { let note="a.diff(b).affectedKeys()"; return a .diff(b).affectedKeys().size()>0 && a.diff(b) .affectedKeys().size()>0 && a.diff(b).affectedKeys().size()>0; }');
 const result=lowerFirestoreMapMethods(original,{minimumUses:1});assert.equal(result.proof.calls,1);assert.ok(result.source.includes('let note="a.diff(b).affectedKeys()"'));assert.ok(result.source.includes('a .diff(b)'));
});
test('fresh selector names and parameters cannot capture existing source names',()=>{
 const original=wrap('function tkMapAffectedKeys(a,b) { return a==b; } function f(a,b) { return a.diff(b).affectedKeys().size()>0; }');
 const result=lowerFirestoreMapMethods(original,{minimumUses:1});assert.equal(result.proof.selectors[0].name,'tkMapAffectedKeys1');
});
test('independent proof rejects changed selectors, reordered operands and changed original predicates even with updated hashes',()=>{
 const original=wrap('function f(a,b) { return a.diff(b).affectedKeys().hasOnly(["x"]); }'),result=lowerFirestoreMapMethods(original,{minimumUses:1});
 for(const next of [result.source.replace('.affectedKeys();','.addedKeys();'),result.source.replace('((a),(b))','((b),(a))'),result.source.replace('.hasOnly(["x"])','.hasOnly(["y"])')]){
  assert.notEqual(next,result.source);assert.throws(()=>assertMapMethodLoweringEquivalent(original,next,changed(result.proof,next)),/pinned selector|another source byte/);
 }
});
test('literal/getter list computation is pure and invalid map operands remain denied before and after factoring',()=>{
 const deny=fn=>{try{return fn();}catch{return 'deny';}},keysOnly=(map,list)=>map.keys().hasOnly(list);
 const valid={keys:()=>({hasOnly:list=>Array.isArray(list)&&list.every(value=>typeof value==='string')})};
 for(const map of [valid,null,{},false,'text'])for(const list of [[],['x'],['x','y']]){
  const old=deny(()=>map.keys().hasOnly(list)),next=deny(()=>keysOnly(map,list));assert.equal(next,old);
 }
});
test('diff helper invokes the same immutable MapDiff and Set method and preserves failures',()=>{
 const deny=fn=>{try{return fn();}catch{return 'deny';}},after={diff:before=>{if(!before?.map)throw Error('invalid before');return {affectedKeys:()=>new Set(['x'])};}},helper=(a,b)=>a.diff(b).affectedKeys();
 for(const a of [after,null,{},'text'])for(const b of [{map:true},null,{}]){
  const old=deny(()=>a.diff(b).affectedKeys()),next=deny(()=>helper(a,b));assert.deepEqual(next,old);
 }
});
