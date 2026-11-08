import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {shareBoundedNumbers,assertBoundedNumbersEquivalent} from '../tools/firestore-selector-sharing/bounded-numbers.mjs';
import {tokenizeRules} from '../tools/firestore-rule-core.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const wrap=body=>`rules_version='2'; service cloud.firestore { match /databases/{database}/documents { ${body} } }`;
const atom=(type='number',lower='>=',upper='<=',min='0',max='4')=>`data.value is ${type} && data.value ${lower} ${min}`+(upper?` && data.value ${upper} ${max}`:'');
const fixture=expression=>wrap(`function subject(data,gate) { return gate && (${expression}); } function other(data) { return ${expression}; }`);
function functions(source){const code=tokenizeRules(source).filter(token=>!['whitespace','comment'].includes(token.type)),found=[];for(let at=0;at<code.length;at++)if(code[at].text==='function'){const start=at;while(code[at].text!=='{')at++;let depth=1;while(depth){at++;if(code[at].text==='{')depth++;if(code[at].text==='}')depth--;}found.push(source.slice(code[start].start,code[at].end));}return found.join('\n').replace(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+is\s+number/g,"(typeof $1 === 'number')").replace(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+is\s+int/g,'Number.isInteger($1)');}
function evaluate(source,value,{gate=true,broken=false}={}){let reads=0,result,error;const data={get value(){reads++;if(broken)throw Error('missing immutable field');return value;}};try{result=vm.runInNewContext(functions(source)+'\nsubject(data,gate);',{data,gate,Number});}catch(failure){error=failure.message;}return{result,error,reads};}

test('all four exact numeric comparator pairs and both types preserve boundary values and deny other types',()=>{
 for(const type of ['number','int'])for(const lower of ['>','>='])for(const upper of ['<','<=']){const original=fixture(atom(type,lower,upper)),result=shareBoundedNumbers(original);assert.equal(result.proof.sites.length,2);assert.equal(assertBoundedNumbersEquivalent(original,result.source,result.proof).exactInverseBytes,true);for(const value of [-1,0,.5,1,3.999,4,5,NaN,Infinity,-Infinity,'0',null,undefined,true,[],{}])for(const gate of [true,false]){const before=evaluate(original,value,{gate}),after=evaluate(result.source,value,{gate});assert.equal(after.result,before.result,[type,lower,upper,value,gate].join(':'));assert.equal(after.error,before.error);if(!gate)assert.equal(after.reads,0);else assert.equal(after.reads,1);}}
});
test('single positive/nonnegative numeric lower bounds are optional and retain exact type',()=>{
 for(const type of ['number','int'])for(const lower of ['>','>=']){const original=fixture(atom(type,lower,null));assert.equal(shareBoundedNumbers(original).source,original);const result=shareBoundedNumbers(original,{includeSingleBounds:true});assert.equal(result.proof.sites.length,2);for(const value of [-1,0,.5,1,'1',null])assert.equal(evaluate(result.source,value).result,evaluate(original,value).result);assert.match(result.proof.helpers[0].declaration,new RegExp(' is '+type));}
});
test('negative, fractional and exponent bound tokens are passed unchanged without numeric conversion',()=>{
 const original=fixture(atom('number','>=','<','-1.5','2e2')),result=shareBoundedNumbers(original);assert.deepEqual(result.proof.sites.map(site=>site.bounds),[['-1.5','2e2'],['-1.5','2e2']]);for(const value of [-2,-1.5,0,199.9,200])assert.equal(evaluate(result.source,value).result,evaluate(original,value).result);assert.equal(assertBoundedNumbersEquivalent(original,result.source,result.proof,{returnSource:true}),original);
});
test('short-circuiting preserves both unevaluated field errors and the original first-field failure',()=>{
 const original=fixture(atom()),result=shareBoundedNumbers(original);for(const gate of [true,false])assert.deepEqual(evaluate(result.source,1,{gate,broken:true}),evaluate(original,1,{gate,broken:true}));
});
test('surrounding OR, negated groups, ternaries and array/map/let positions retain the complete original predicate',()=>{
 for(const expression of [atom()+' || gate','gate || '+atom(),'!('+atom()+')',atom()+' ? true : gate','gate ? ('+atom()+') : false']){const original=fixture(expression),result=shareBoundedNumbers(original);assert.equal(result.proof.sites.length,2);for(const value of [-1,0,2,5,null])for(const gate of [true,false])assert.equal(evaluate(result.source,value,{gate}).result,evaluate(original,value,{gate}).result);}
 for(const body of ['return [('+atom()+')];',"return {'okay':("+atom()+')};','let okay='+atom()+'; return okay;']){const original=wrap(`function first(data){${body}} function second(data){${body}}`),result=shareBoundedNumbers(original);assert.equal(result.proof.sites.length,2);assert.equal(assertBoundedNumbersEquivalent(original,result.source,result.proof,{returnSource:true}),original);}
});
test('dynamic or arithmetic bounds, changed fields and arbitrary receiver calls never become eligible prefixes',()=>{
 const raws=['data.value is number && data.value>=minimum && data.value<=4','data.value is number && data.value>=0 && data.value<=maximum','data.value is number && data.value>=0 && data.value<=4+1','data.value is number && data.value>=0+1 && data.value<=4','data.value is number && data.other>=0 && data.value<=4','readValue() is number && readValue()>=0 && readValue()<=4',"data.get('value',0) is number && data.get('value',0)>=0",'data.value is float && data.value>=0 && data.value<=4','data.value is int && data.value>=0 && data.value<=4.abs()','data.value is number && data.value>=0 && data.value<=4[0]','other + '+atom(),'!'+atom(),atom()+' + 1',atom()+' == true'];
 for(const raw of raws)for(const includeSingleBounds of [false,true]){const original=fixture(raw);assert.equal(shareBoundedNumbers(original,{includeSingleBounds}).source,original,raw);}
});
test('literal/comment text is opaque, exact field comments roundtrip and fresh names cannot capture locals',()=>{
 const raw='data /*field*/ . value is int && data . value>=0 && data.value < 4',original=fixture(raw)+`\n// ${atom()}\n`,result=shareBoundedNumbers(original);assert.equal(result.proof.sites.length,2);assert.ok(result.source.includes('// '+atom()));assert.equal(assertBoundedNumbersEquivalent(original,result.source,result.proof,{returnSource:true}),original);
 const shadow=fixture(atom()).replace('subject(data,gate)','subject(data,gate,boundedNumericValue,boundedNumberInclusiveRange)'),fresh=shareBoundedNumbers(shadow);assert.equal(fresh.proof.helpers[0].name,'boundedNumberInclusiveRange1');assert.equal(fresh.proof.helpers[0].parameters[0],'boundedNumericValue1');
});
test('supplied wage/batch exclusions remain byte-exact while other predicates share normally',()=>{
 const protectedBody=`function staffRateHQ(data){return ${atom()};}`,original=wrap(protectedBody+`function subject(data,gate){return gate && (${atom()});} function other(data){return ${atom()};}`),result=shareBoundedNumbers(original,{excludedFunctions:['staffRateHQ']});assert.ok(result.source.includes(protectedBody));assert.equal(result.proof.sites.length,2);assert.equal(assertBoundedNumbersEquivalent(original,result.source,result.proof,{returnSource:true}),original);
 for(const excludedFunctions of [null,'staffRateHQ',['staffRateHQ','staffRateHQ'],['staffRateHQ()'],[12]])assert.throws(()=>shareBoundedNumbers(original,{excludedFunctions}));assert.throws(()=>assertBoundedNumbersEquivalent(original,result.source,{...result.proof,excludedFunctions:[]}),/coverage/);
});
test('proof verification rejects changed types/operators/operands even when output hashes are refreshed',()=>{
 const original=fixture(atom()),result=shareBoundedNumbers(original);for(const changed of [result.source.replace(' is number',' is int'),result.source.replace(' >= ',' > '),result.source.replace('(data.value)','(data.other)'),result.source.replace('(4)','(5)')]){assert.notEqual(changed,result.source);assert.throws(()=>assertBoundedNumbersEquivalent(original,changed,{...result.proof,loweredSha256:hash(changed)}));}
 for(const change of [proof=>{proof.sites[0].bounds[0]='1';},proof=>{proof.sites[0].type='int';},proof=>{proof.helpers[0].kind='exclusiveRange';},proof=>{proof.insertionOffset++;}]){const proof=structuredClone(result.proof);change(proof);assert.throws(()=>assertBoundedNumbersEquivalent(original,result.source,proof));}
});
test('application candidate stays unchanged and the generated-only numeric output independently recovers it byte for byte',()=>{
 const url=new URL('../firestore.policy.rules',import.meta.url),original=fs.readFileSync(url,'utf8'),result=shareBoundedNumbers(original,{includeSingleBounds:true,excludedFunctions:['staffRateHQ','staffRateValue','cashShortagePayrollRow']});assert.ok(result.proof.sites.length>10);assert.equal(assertBoundedNumbersEquivalent(original,result.source,result.proof,{returnSource:true}),original);assert.equal(fs.readFileSync(url,'utf8'),original);assert.equal(result.statistics.noNewReads,true);assert.equal(shareBoundedNumbers(result.source,{includeSingleBounds:true,excludedFunctions:['staffRateHQ','staffRateValue','cashShortagePayrollRow']}).source,result.source);
});
