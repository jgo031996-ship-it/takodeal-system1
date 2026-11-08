import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {shareConstantMapGets,assertConstantMapGetsEquivalent} from '../tools/firestore-selector-sharing/constant-map-gets.mjs';
import {tokenizeRules} from '../tools/firestore-rule-core.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const wrap=body=>`rules_version='2'; service cloud.firestore { match /databases/{database}/documents { ${body} } }`;
const fixture=(expression="data.saved.get('status','')")=>wrap(`function subject(data,gate){return gate && ${expression};} function second(data,gate){return gate && ${expression};} function third(data,gate){return gate && ${expression};}`);
function jsFunctions(source){
 const code=tokenizeRules(source).filter(token=>!['whitespace','comment'].includes(token.type)),found=[];
 for(let at=0;at<code.length;at++)if(code[at].text==='function'){const start=at;while(code[at]?.text!=='{')at++;let depth=1;while(depth){at++;if(code[at].text==='{')depth++;else if(code[at].text==='}')depth--;}found.push(source.slice(code[start].start,code[at].end));}
 return found.join('\n');
}
function evaluate(source,record,{gate=true,failReceiver=false}={}){
 const trace=[];const saved=record==null?record:{get(key,fallback){trace.push(['get',key,fallback]);return Object.hasOwn(record,key)?record[key]:fallback;}};
 const data={get saved(){trace.push('receiver');if(failReceiver)throw Error('missing receiver');return saved;}};let result,error;
 try{result=vm.runInNewContext(jsFunctions(source)+'\nsubject(data,gate);',{data,gate});}catch(failure){error=failure.message;}
 return {result,error,trace};
}
test('exact key/default groups share only repeated literal getters and reverse every byte',()=>{
 const original=fixture(),result=shareConstantMapGets(original);
 assert.equal(result.proof.helpers.length,1);assert.equal(result.proof.sites.length,3);assert.equal(result.statistics.noNewReads,true);assert.equal(result.statistics.sameErrorDenial,true);
 assert.equal(assertConstantMapGetsEquivalent(original,result.source,result.proof,{returnSource:true}),original);assert.equal(shareConstantMapGets(result.source).source,result.source);
 assert.match(result.proof.helpers[0].declaration,/\.get\('status',''\)/);
});
test('actual generated functions preserve own values, missing defaults and original checkpoint',()=>{
 const source=fixture(),result=shareConstantMapGets(source);
 for(const record of [{},{status:'Paid'},{status:''},{status:null},{status:0},{status:false},null,undefined])for(const gate of [false,true]){
  const before=evaluate(source,record,{gate}),after=evaluate(result.source,record,{gate});assert.deepEqual(after,before);
  if(!gate)assert.deepEqual(after.trace,[]);else assert.equal(after.trace.filter(value=>value==='receiver').length,1);
 }
 assert.deepEqual(evaluate(result.source,{}, {failReceiver:true}),evaluate(source,{}, {failReceiver:true}));
});
test('literal defaults keep exact kind, spelling and tokens without coercion',()=>{
 for(const fallback of ['null','true','false','-1','1.25','2e2','[]','{}',"'Paid'",'"Paid"']){
  const source=fixture(`data.saved.get('status',${fallback})`),result=shareConstantMapGets(source);assert.equal(result.proof.sites.length,3,fallback);assert.equal(result.proof.helpers[0].defaultValue,fallback);assert.equal(assertConstantMapGetsEquivalent(source,result.source,result.proof,{returnSource:true}),source);
  const before=evaluate(source,{}),after=evaluate(result.source,{});assert.equal(JSON.stringify(after),JSON.stringify(before));
 }
});
test('dynamic keys/defaults, methods, indexing and arithmetic defaults stay inline',()=>{
 for(const expression of ["data.saved.get(key,'')","data.saved.get('status',fallback)","data.saved.get('status',read())","data.saved.get('status',1+2)","data.saved.get('status',['Paid'])","data.saved.get('status',{'paid':true})","read().get('status','')","data.saved[0].get('status','')"]){
  const source=fixture(expression).replaceAll('(data,gate)','(data,gate,key,fallback)');assert.equal(shareConstantMapGets(source).source,source,expression);
 }
});
test('field suffixes, boolean placement, nested call and unary expressions keep exact atom boundaries',()=>{
 for(const expression of ["!data.saved.get('status','')","data.saved.get('status','') == 'Paid'","data.saved.get('status','').size()","[data.saved.get('status','')]","gate ? data.saved.get('status','') : false"]){const source=fixture(expression),result=shareConstantMapGets(source);assert.equal(result.proof.sites.length,3);assert.equal(assertConstantMapGetsEquivalent(source,result.source,result.proof,{returnSource:true}),source);}
});
test('getter comments survive round-trip and opaque strings are never selected',()=>{
 const source=fixture("data /*same*/ . saved . get ( 'status' /*key*/, '' /*default*/ )")+"\n// data.saved.get('status','')",result=shareConstantMapGets(source);assert.equal(result.proof.sites.length,3);assert.equal(assertConstantMapGetsEquivalent(source,result.source,result.proof,{returnSource:true}),source);
});
test('different defaults and literal quote spellings never merge groups',()=>{
 const source=wrap("function a(data){return data.get('status','');} function b(data){return data.get('status',null);} function c(data){return data.get(\"status\",'');}"),result=shareConstantMapGets(source,{minimumUses:2});assert.equal(result.source,source);
});
test('excluded budget-sensitive validators retain byte-exact reads and exclusions are validated',()=>{
 const body="function staffRateHQ(data){return data.saved.get('status','');}",source=fixture()+'';
 const combined=source.replace('function subject',body+'function subject'),result=shareConstantMapGets(combined,{excludedFunctions:['staffRateHQ']});assert.ok(result.source.includes(body));assert.equal(result.proof.sites.length,3);assert.equal(assertConstantMapGetsEquivalent(combined,result.source,result.proof,{returnSource:true}),combined);
 for(const excludedFunctions of [null,'staffRateHQ',['bad()'],['staffRateHQ','staffRateHQ'],[1]])assert.throws(()=>shareConstantMapGets(combined,{excludedFunctions}),/unique identifiers/);
 assert.throws(()=>assertConstantMapGetsEquivalent(combined,result.source,{...result.proof,excludedFunctions:[]}),/coverage/);
});
test('fresh bindings avoid source names and exact proof rejects altered keys, defaults, calls and insertion',()=>{
 const source=fixture().replaceAll('(data,gate)','(data,gate,constantMapGet,constantMapValue)'),result=shareConstantMapGets(source);assert.equal(result.proof.helpers[0].name,'constantMapGet1');assert.equal(result.proof.helpers[0].parameter,'constantMapValue1');
 for(const changed of [result.source.replace(".get('status','')",".get('status',null)"),result.source.replace(".get('status','')",".get('branch','')"),result.source.replace('((data.saved))','((data.other))'),result.source.replace('return constantMapValue1.get','return constantMapValue1.other')]){assert.notEqual(changed,result.source);assert.throws(()=>assertConstantMapGetsEquivalent(source,changed,{...result.proof,loweredSha256:sha(changed)}));}
 const proof=structuredClone(result.proof);proof.sites[0].defaultValue='null';assert.throws(()=>assertConstantMapGetsEquivalent(source,result.source,proof),/literal/);
});
test('reviewed application has hundreds of exact sites while every original policy byte is retained',()=>{
 const source=readFileSync(new URL('../firestore.policy.rules',import.meta.url),'utf8'),result=shareConstantMapGets(source);assert.ok(result.proof.sites.length>=240);assert.ok(result.proof.helpers.length>=25);assert.equal(assertConstantMapGetsEquivalent(source,result.source,result.proof,{returnSource:true}),source);assert.equal(readFileSync(new URL('../firestore.policy.rules',import.meta.url),'utf8'),source);
});
