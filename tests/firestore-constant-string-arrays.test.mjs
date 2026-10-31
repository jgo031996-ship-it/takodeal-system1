import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {poolConstantStringArrays,assertConstantStringArrayPoolingEquivalent,censusConstantStringArrays} from '../tools/firestore-selector-sharing/constant-string-arrays.mjs';
import {tokenizeRules,buildFirestoreRulesAlpha as buildFirestoreRules} from '../tools/firestore-rule-core.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
const values=['first-long-field-name','second-long-field-name','third-long-field-name','fourth-long-field-name'];
const literal=JSON.stringify(values),other=JSON.stringify(values.map(value=>'other-'+value));
const wrap=body=>`rules_version = '2';\nservice cloud.firestore {\n match /databases/{database}/documents {\n${body}\n }\n}\n`;
const sample=()=>wrap(`function first() { return ${literal}; }\nfunction second() { return ${literal}; }\nfunction third() { return ${literal}; }`);
const lower=source=>poolConstantStringArrays(source,{minimumEstimatedSavings:0});
function functionCode(source){
 const code=tokenizeRules(source).filter(token=>!['whitespace','comment'].includes(token.type)),functions=[];
 for(let at=0;at<code.length;at++)if(code[at].text==='function'){
  const start=at;while(code[at]?.text!=='{')at++;let depth=1;while(depth){at++;if(code[at].text==='{')depth++;else if(code[at].text==='}')depth--;}
  functions.push(source.slice(code[start].start,code[at].end));
 }
 return functions.join('\n');
}
test('ordered literal lists pool once across three actual return expressions and restore every original byte',()=>{
 const source=sample(),result=lower(source);assert.equal(result.proof.groups.length,1);assert.equal(result.proof.sites.length,3);
 assert.deepEqual(result.proof.groups[0].values,values.map(value=>JSON.stringify(value)));
 assert.equal(assertConstantStringArrayPoolingEquivalent(source,result.source,result.proof).exactInverseBytes,true);
 assert.ok(buildFirestoreRules(result.source).source);assert.equal(lower(result.source).source,result.source);
});
test('the lowered actual functions return the same ordered values and escaping in a real VM',()=>{
 const a=['000123','escaped\nvalue','a comma, and ; delimiter','quote " and slash \\'],raw=JSON.stringify(a),source=wrap(`function first() { return ${raw}; }\nfunction second() { return ${raw}; }`),result=lower(source);
 assert.equal(result.proof.groups.length,1);const evaluate=text=>vm.runInNewContext(functionCode(text)+'\nJSON.stringify([first(),second()]);');
 assert.equal(evaluate(result.source),evaluate(source));assert.deepEqual(JSON.parse(evaluate(result.source)),[a,a]);
});
test('reordered constants, different literal quoting and different escapes are not silently canonicalized',()=>{
 for(const b of [JSON.stringify([...values].reverse()),"['first-long-field-name','second-long-field-name','third-long-field-name','fourth-long-field-name']"]){
  const source=wrap(`function one() { return ${literal}; } function two() { return ${b}; }`);assert.equal(lower(source).source,source);
 }
});
test('dynamic members, booleans, numbers, maps and too-short lists remain unchanged',()=>{
 for(const raw of [`[${values.slice(0,3).map(JSON.stringify).join(',')}, value]`,`[${values.slice(0,3).map(JSON.stringify).join(',')}, true]`,`[${values.slice(0,3).map(JSON.stringify).join(',')}, 12]`,`[${values.slice(0,3).map(JSON.stringify).join(',')}, {'key':'value'}]`,JSON.stringify(values.slice(0,3))]){
  const source=wrap(`function one(value) { return ${raw}; } function two(value) { return ${raw}; }`);assert.equal(lower(source).source,source);
 }
});
test('comments inside an array remain at their exact original sites rather than being discarded or pooled',()=>{
 const raw=literal.replace(',','/* preserve this original comment */,');const source=wrap(`function one() { return ${raw}; } function two() { return ${raw}; }`);assert.equal(lower(source).source,source);
});
test('only the constant inner list is pooled while the containing dynamic map and list stay byte-exact on inverse',()=>{
 const source=wrap(`function one(value) { return {'keep': [${literal},value]}; } function two(value) { return {'keep': [${literal},value]}; }`),result=lower(source);
 assert.equal(result.proof.groups.length,1);assert.equal(result.proof.sites.length,2);assert.equal(result.source.includes("{'keep': ["),true);assertConstantStringArrayPoolingEquivalent(source,result.source,result.proof);
});
test('fresh helper names cannot capture existing function parameters or helper declarations',()=>{
 const source=wrap(`function one(pooledStringArray0) { return ${literal}; } function pooledStringArray1() { return ${literal}; }`),result=lower(source);
 assert.equal(result.proof.groups[0].name,'pooledStringArray2');assertConstantStringArrayPoolingEquivalent(source,result.source,result.proof);
});
test('parenthesized calls preserve return-keyword, membership and member/index boundaries without inventing whitespace',()=>{
 const source=wrap(`function first(){return${literal};} function second(){return${literal}[0];} function third(){return${literal}.size();}`),result=lower(source);
 assert.match(result.source,/return\(pooledStringArray\d+\(\)\)/);assertConstantStringArrayPoolingEquivalent(source,result.source,result.proof);assert.ok(buildFirestoreRules(result.source).source);
});
test('a literal outside the documents scope is never lowered into a helper that is not visible there',()=>{
 const source=`rules_version = '2';\nservice cloud.firestore {function outside(){return ${literal};} match /databases/{database}/documents {function inside(){return ${literal};}}}`;
 assert.equal(lower(source).source,source);
});
test('changing a constant while updating the output hash still fails exact helper declaration verification',()=>{
 const original=sample(),result=lower(original),bad=result.source.replace(values[0],'injected-different-value'),proof={...result.proof,loweredSha256:hash(bad)};
 assert.throws(()=>assertConstantStringArrayPoolingEquivalent(original,bad,proof),/declarations/);
});
test('a forged helper literal and inserted declaration cannot change the original callsite list',()=>{
 const original=sample(),result=lower(original),proof=structuredClone(result.proof),group=proof.groups[0],bad=result.source.replace(values[0],'injected-different-value');
 group.literal=group.literal.replace(values[0],'injected-different-value');group.values[0]=JSON.stringify('injected-different-value');group.declaration=group.declaration.replace(values[0],'injected-different-value');proof.insertion=proof.insertion.replace(values[0],'injected-different-value');proof.loweredSha256=hash(bad);
 assert.throws(()=>assertConstantStringArrayPoolingEquivalent(original,bad,proof),/ordered literal tokens/);
});
test('swapping two groups at original sites is rejected despite a valid new output hash',()=>{
 const original=wrap(`function a(){return ${literal};} function b(){return ${literal};} function c(){return ${other};} function d(){return ${other};}`),result=lower(original),[a,b]=result.proof.groups;
 assert.equal(result.proof.groups.length,2);const marker='temporary-test-marker',bad=result.source.replace('('+a.name+'())',marker).replace('('+b.name+'())','('+a.name+'())').replace(marker,'('+b.name+'())');
 assert.throws(()=>assertConstantStringArrayPoolingEquivalent(original,bad,{...result.proof,loweredSha256:hash(bad)}),/call moved/);
});
test('extra permission code and missing call boundaries cannot hide behind a refreshed output hash',()=>{
 const original=sample(),result=lower(original);for(const bad of [result.source.replace('return (','return true || ('),result.source.replace('(pooledStringArray0())','pooledStringArray0()')])assert.throws(()=>assertConstantStringArrayPoolingEquivalent(original,bad,{...result.proof,loweredSha256:hash(bad)}));
});
test('unsupported scope and weakened minimum-entry settings fail closed',()=>{
 assert.throws(()=>lower('service cloud.firestore {}'),/scope/);assert.throws(()=>poolConstantStringArrays(sample(),{minimumEntries:1}),/four/);
});
test('the census reports exact ordered string groups without turning it into a claimed executable saving',()=>{
 const rows=censusConstantStringArrays(sample());assert.equal(rows.length,1);assert.equal(rows[0].entries,4);assert.equal(rows[0].occurrences,3);assert.ok(rows[0].estimatedAliasBytesSaved>0);
});
