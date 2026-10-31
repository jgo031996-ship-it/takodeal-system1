import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {lowerRequestEqualities,assertRequestEqualitiesEquivalent} from '../tools/firestore-selector-sharing/request-equalities.mjs';
import {tokenizeRules,buildFirestoreRulesAlpha as buildFirestoreRules} from '../tools/firestore-rule-core.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
const helpers=`function reqUid() { return request.auth.uid; }
function reqEmail() { return request.auth.token.email; }
function reqTime() { return request.time; }`;
const wrap=body=>`rules_version = '2';\nservice cloud.firestore {\n match /databases/{database}/documents {\n${helpers}\n${body}\n }\n}\n`;
test('excluded per-row request equalities retain their original getter while selected calls still invert exactly',()=>{
 const shared='function staffRateHQ(data) { return data.owner == reqUid(); }',source=wrap(shared+'function subject(data) { return data.owner == reqUid(); }'),result=lowerRequestEqualities(source,{excludedFunctions:['staffRateHQ']});assert.ok(result.source.includes(shared));assert.equal(result.proof.sites.length,1);assert.deepEqual(result.proof.excludedFunctions,['staffRateHQ']);assert.equal(assertRequestEqualitiesEquivalent(source,result.source,result.proof,{returnSource:true}),source);
});
test('request-equality exclusions reject invalid identifiers and an altered scope proof cannot conceal a comparison',()=>{
 const source=wrap('function staffRateHQ(data) { return data.owner == reqUid(); } function subject(data) { return data.owner == reqUid(); }');for(const excludedFunctions of [null,'staffRateHQ',['staffRateHQ','staffRateHQ'],['staffRateHQ()'],[12]])assert.throws(()=>lowerRequestEqualities(source,{excludedFunctions}),/unique identifiers/);const result=lowerRequestEqualities(source,{excludedFunctions:['staffRateHQ']});assert.throws(()=>assertRequestEqualitiesEquivalent(source,result.source,{...result.proof,excludedFunctions:[]}),/missing|added/);const altered=result.source.replace('staffRateHQ(data) { return data.owner == reqUid();','staffRateHQ(data) { return data.other == reqUid();');assert.notEqual(altered,result.source);assert.throws(()=>assertRequestEqualitiesEquivalent(source,altered,{...result.proof,loweredSha256:hash(altered)}));
});
function functionCode(source){
 const code=tokenizeRules(source).filter(token=>!['whitespace','comment'].includes(token.type)),found=[];
 for(let at=0;at<code.length;at++)if(code[at].text==='function'){
  const start=at;while(code[at]?.text!=='{')at++;let depth=1;while(depth){at++;if(code[at].text==='{')depth++;else if(code[at].text==='}')depth--;}
  found.push(source.slice(code[start].start,code[at].end));
 }
 return found.join('\n');
}
function run(source,{field=12,uid=12,email='a@example.test',time=34,fieldError=false,authError=false,gate=true}={}){
 const trace=[],data={get value(){trace.push('field');if(fieldError)throw Error('field denied');return field;}};
 const request={
  get auth(){
   trace.push('auth');if(authError)throw Error('auth denied');
   return {
    get uid(){trace.push('uid');return uid;},
    get token(){trace.push('token');return {get email(){trace.push('email');return email;}};}
   };
  },
  get time(){trace.push('time');return time;}
 };
 const context={data,request,gate};let value,error;
 try{value=vm.runInNewContext(functionCode(source)+'\nsubject(data,gate);',context);}catch(failure){error=failure.message;}
 return {value,error,trace};
}
test('all three pinned selectors become fresh one-argument helpers with exact inverse bytes',()=>{
 const source=wrap('function subject(data) { return data.uid == reqUid() && data.email == reqEmail() && data.at == reqTime(); }'),result=lowerRequestEqualities(source);
 assert.deepEqual(result.statistics.bySelector,{reqUid:1,reqEmail:1,reqTime:1});assert.equal(result.proof.helpers.length,3);
 assert.equal(assertRequestEqualitiesEquivalent(source,result.source,result.proof).exactInverseBytes,true);assert.ok(buildFirestoreRules(result.source).source);
 assert.equal(lowerRequestEqualities(result.source).source,result.source);
});
test('real equality evaluation keeps one field read before the same UID request read, including denial errors',()=>{
 const source=wrap('function subject(data) { return data.value == reqUid(); }'),result=lowerRequestEqualities(source);
 for(const options of [{},{field:1,uid:2},{fieldError:true},{authError:true},{field:null,uid:12}])assert.deepEqual(run(result.source,options),run(source,options));
 assert.deepEqual(run(result.source).trace,['field','auth','uid']);assert.deepEqual(run(result.source,{fieldError:true}).trace,['field']);
});
test('Email and Time selectors retain getter order and values in actual lowered VM functions',()=>{
 for(const [selector,values] of [['reqEmail',{field:'a@example.test'}],['reqTime',{field:34}]]){
  const source=wrap(`function subject(data) { return data.value == ${selector}(); }`),result=lowerRequestEqualities(source);
  assert.deepEqual(run(result.source,values),run(source,values));assert.equal(run(result.source,values).value,true);
 }
});
test('short-circuited branches never evaluate a newly eager field or request selector',()=>{
 for(const raw of ['gate && data.value == reqUid()','gate ? data.value == reqUid() : false','!gate || data.value == reqUid()']){
  const source=wrap(`function subject(data,gate) { return ${raw}; }`),result=lowerRequestEqualities(source);
  for(const gate of [true,false])assert.deepEqual(run(result.source,{gate,fieldError:true}),run(source,{gate,fieldError:true}));
 }
});
test('nested dotted fields, complete arguments, map values, let initializers and grouped negation are supported',()=>{
 const expressions=['return data.deep.value==reqUid();','return same(data.value == reqUid(), true);','return [data.value == reqUid()];',"return {'ok':data.value==reqUid()};",'let okay=data.value==reqUid(); return okay;','return !(data.value==reqUid());'];
 for(const body of expressions){const source=wrap(`function same(a,b){return a==b;} function subject(data){${body}}`),result=lowerRequestEqualities(source);assert.equal(result.proof.sites.length,1,body);assertRequestEqualitiesEquivalent(source,result.source,result.proof);}
});
test('unary and arithmetic left operands are never mistaken for a simple field equality',()=>{
 for(const raw of ['!data.value == reqUid()','-data.value == reqUid()','other + data.value == reqUid()','other * data.value == reqUid()','other == data.value == reqUid()','other != data.value == reqUid()','other < data.value == reqUid()','data.value[0] == reqUid()','(data.value) == reqUid()','data.value() == reqUid()']){
  const source=wrap(`function subject(data,other) { return ${raw}; }`),result=lowerRequestEqualities(source);assert.equal(result.proof.sites.length,0,raw);assert.equal(result.source,source,raw);
 }
});
test('arithmetic, property, index and chained comparison right operands stay untouched',()=>{
 for(const raw of ['data.value == reqTime() + duration.value(1, "h")','data.value == reqEmail().trim()','data.value == reqUid()[0]','data.value == reqUid() == other','data.value == reqUid() is string','data.value == reqUid() in [other]','data.value == reqUid() / other']){
  const source=wrap(`function subject(data,other) { return ${raw}; }`),result=lowerRequestEqualities(source);assert.equal(result.proof.sites.length,0,raw);assert.equal(result.source,source,raw);
 }
});
test('strictly different operators, object methods and calls with arguments remain unchanged',()=>{
 for(const raw of ['data.value != reqUid()','data.value <= reqTime()','data.value === reqUid()','data.value == object.reqUid()']){
  const source=wrap(`function subject(data,object) { return ${raw}; }`),result=lowerRequestEqualities(source);assert.equal(result.source,source,raw);
 }
 assert.throws(()=>lowerRequestEqualities(wrap('function subject(data){return data.value == reqUid(data);}')),/arguments/);
});
test('source comments and strings are opaque and restore byte-exactly at transformed sites',()=>{
 const source=wrap('function subject(data) { /* data.other == reqUid() */ return data /*field note*/ . value == /*selector note*/ reqUid(); } function text(){return "data.value == reqUid()";}'),result=lowerRequestEqualities(source);
 assert.equal(result.proof.sites.length,1);assert.match(result.source,/\/\*field note\*\//);assert.match(result.source,/\/\* data.other == reqUid\(\) \*\//);assertRequestEqualitiesEquivalent(source,result.source,result.proof);
});
test('helper and parameter names cannot capture any pre-existing code identifiers',()=>{
 const source=wrap('function requestUidEquals(){return true;} function subject(data,equalityValue,requestUidEquals1){return data.value==reqUid();}'),result=lowerRequestEqualities(source);
 assert.equal(result.proof.helpers[0].name,'requestUidEquals2');assert.equal(result.proof.helpers[0].parameter,'equalityValue1');assertRequestEqualitiesEquivalent(source,result.source,result.proof);
});
test('altered selector bodies, arity, child scope, captures and shadowing fail closed',()=>{
 for(const source of [
  wrap('function subject(data){return data.value==reqUid();}').replace('return request.auth.uid;','return request.auth.token.email;'),
  wrap('function subject(data){return data.value==reqUid();}').replace('reqTime() {','reqTime(x) {'),
  wrap('function subject(data,reqUid){return data.value==reqUid();}'),
  wrap('match /records/{reqUid} { allow read: if resource.data.value==reqUid(); }'),
  wrap('function subject(data){return data.value==reqUid();}').replace('function reqTime() { return request.time; }','match /records/{id} { function reqTime() { return request.time; } }')
 ])assert.throws(()=>lowerRequestEqualities(source));
});
test('outside-document expressions are not lowered into an invisible helper',()=>{
 const source=`rules_version='2'; service cloud.firestore {function outside(data){return data.value==reqUid();} match /databases/{database}/documents {${helpers}}}`,result=lowerRequestEqualities(source);
 assert.equal(result.proof.sites.length,0);assert.equal(result.source,source);
});
test('refreshing output hash cannot conceal a changed helper operator or selector',()=>{
 const source=wrap('function subject(data){return data.value==reqUid();}'),result=lowerRequestEqualities(source);
 for(const bad of [result.source.replace('equalityValue == request.auth.uid','equalityValue != request.auth.uid'),result.source.replace('(requestUidEquals(data.value))','(requestUidEquals(data.other))')])assert.throws(()=>assertRequestEqualitiesEquivalent(source,bad,{...result.proof,loweredSha256:hash(bad)}));
});
test('forged proof sites or insertion cannot turn another expression into an eligible equality',()=>{
 const source=wrap('function subject(data){return data.value==reqUid();}'),result=lowerRequestEqualities(source),proof=structuredClone(result.proof);
 proof.sites[0].field='data.other';assert.throws(()=>assertRequestEqualitiesEquivalent(source,result.source,proof),/operand/);
 const bad=result.source.replace('return (requestUidEquals(data.value))','return true || (requestUidEquals(data.value))');assert.throws(()=>assertRequestEqualitiesEquivalent(source,bad,{...result.proof,loweredSha256:hash(bad)}),/inverse/);
});
test('frozen app policy lowers the actual bounded atom census without touching the candidate',()=>{
 const source=fs.readFileSync(new URL('../firestore.policy.rules',import.meta.url),'utf8'),result=lowerRequestEqualities(source);
 assert.deepEqual(result.statistics.bySelector,{reqUid:40,reqEmail:38,reqTime:112});assert.equal(result.proof.sites.length,190);
 assert.equal(assertRequestEqualitiesEquivalent(source,result.source,result.proof).pinnedGlobalSelectors,true);
 assert.equal(fs.readFileSync(new URL('../firestore.policy.rules',import.meta.url),'utf8'),source);
});
