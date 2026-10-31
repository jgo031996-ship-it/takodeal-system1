import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import {createHash} from 'node:crypto';
import {shareBoundedText,assertBoundedTextSharingEquivalent} from '../tools/firestore-selector-sharing/bounded-text.mjs';
import {tokenizeRules,buildFirestoreRulesAlpha as buildFirestoreRules} from '../tools/firestore-rule-core.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const wrap=body=>`rules_version='2'; service cloud.firestore { match /databases/{database}/documents { ${body} } }`;
const guard=(field,lower='0',upper='200',operator='>')=>`${field} is string && ${field}.size() ${operator} ${lower} && ${field}.size() <= ${upper}`;
const fixture=(options={})=>wrap(`function subject(data,gate) { return gate && ${guard('data.value',options.lower,options.upper,options.operator)}; } function other(data) { return ${guard('data.value',options.lower2??options.lower,options.upper2??options.upper,options.operator)}; }`);
test('an excluded repeated validator retains its original string checks without an extra bounded-text frame',()=>{
 const shared=`function staffRateHQ(data) { return ${guard('data.value')}; }`,source=wrap(shared+`function first(data) { return ${guard('data.value')}; } function second(data) { return ${guard('data.value')}; }`),result=shareBoundedText(source,{excludedFunctions:['staffRateHQ']});assert.ok(result.source.includes(shared));assert.equal(result.proof.sites.length,2);assert.deepEqual(result.proof.excludedFunctions,['staffRateHQ']);assert.equal(assertBoundedTextSharingEquivalent(source,result.source,result.proof,{returnSource:true}),source);
});
test('bounded-text exclusions reject invalid names and cannot conceal changed scope or an inline bound',()=>{
 const source=wrap(`function staffRateHQ(data) { return ${guard('data.value')}; } function first(data) { return ${guard('data.value')}; } function second(data) { return ${guard('data.value')}; }`);for(const excludedFunctions of [null,'staffRateHQ',['staffRateHQ','staffRateHQ'],['staffRateHQ()'],[12]])assert.throws(()=>shareBoundedText(source,{excludedFunctions}),/unique identifiers/);const result=shareBoundedText(source,{excludedFunctions:['staffRateHQ']});assert.throws(()=>assertBoundedTextSharingEquivalent(source,result.source,{...result.proof,excludedFunctions:[]}),/coverage/);const altered=result.source.replace('data.value.size() <= 200','data.value.size() <= 201');assert.notEqual(altered,result.source);assert.throws(()=>assertBoundedTextSharingEquivalent(source,altered,{...result.proof,loweredSha256:sha(altered)}));
});
function jsFunctions(source){
 const code=tokenizeRules(source).filter(token=>!['whitespace','comment'].includes(token.type)),found=[];
 for(let at=0;at<code.length;at++)if(code[at].text==='function'){
  const start=at;while(code[at]?.text!=='{')at++;let depth=1;while(depth){at++;if(code[at].text==='{')depth++;else if(code[at].text==='}')depth--;}
  found.push(source.slice(code[start].start,code[at].end));
 }
 // Only the Rules string predicate and String.size spellings need adapting;
 // every original/lowered function body, constant and operator is executed.
 return found.join('\n').replace(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+is\s+string/g,"(typeof $1 === 'string')").replace(/\.size\(\)/g,'.length');
}
function evaluate(source,value,gate=true){
 let firstReads=0;const data={get value(){firstReads++;return value;}};let result,error;
 try{result=vm.runInNewContext(jsFunctions(source)+'\nsubject(data,gate);',{data,gate});}catch(failure){error=failure.message;}
 return {result,error,firstReads};
}
test('two exact operator-pattern helpers share different literal bounds without changing them',()=>{
 const original=fixture({lower:'0',upper:'200',lower2:'8',upper2:'1500'}),result=shareBoundedText(original);
 assert.equal(result.proof.helpers.length,1);assert.equal(result.proof.sites.length,2);assert.deepEqual(result.proof.sites.map(site=>site.bounds),[['0','200'],['8','1500']]);
 assert.equal(assertBoundedTextSharingEquivalent(original,result.source,result.proof).exactInverseBytes,true);assert.ok(buildFirestoreRules(result.source).source);assert.equal(shareBoundedText(result.source).source,result.source);
});
test('all immutable values keep type/size boundaries and inclusivity in actual extracted functions',()=>{
 const values=['','a','abc','abcd','abcde','x'.repeat(200),null,undefined,0,3,true,[],{},new String('abc')];
 for(const operator of ['>','>=']){
  const source=fixture({lower:'1',upper:'4',operator}),result=shareBoundedText(source);
  for(const value of values)for(const gate of [false,true]){
   const before=evaluate(source,value,gate),after=evaluate(result.source,value,gate);assert.equal(after.result,before.result);assert.equal(after.error,before.error);
   if(!gate)assert.equal(after.firstReads,0);else assert.equal(after.firstReads,1,'the immutable field is captured at its original type-check checkpoint');
  }
 }
});
test('minimum and maximum constants retain exact negative, decimal and exponent tokens',()=>{
 const source=fixture({lower:'-1.5',upper:'2e2',lower2:'-2',upper2:'200.0'}),result=shareBoundedText(source);
 assert.deepEqual(result.proof.sites.map(site=>site.bounds),[['-1.5','2e2'],['-2','200.0']]);assertRequestIndependent(source,result);
 for(const value of ['','a','abc',undefined])assert.equal(evaluate(result.source,value).result,evaluate(source,value).result);
});
function assertRequestIndependent(source,result){assert.equal(assertBoundedTextSharingEquivalent(source,result.source,result.proof).exactBoundLiteralTokens,true);}
test('no numeric type conversion, trim, Unicode normalization or alternative length method is introduced',()=>{
 const source=fixture({lower:'0',upper:'4'}),result=shareBoundedText(source);
 for(const value of ['    ','é','e\u0301','😀','😀😀','0001'])assert.equal(evaluate(result.source,value).result,evaluate(source,value).result);
 for(const helper of result.proof.helpers){assert.match(helper.declaration,/ is string/);assert.doesNotMatch(helper.declaration,/trim|number|int|float|normalize/);}
});
test('field failure and short circuit remain denied or unevaluated without new document reads',()=>{
 const source=fixture(),result=shareBoundedText(source),execute=text=>{let reads=0;const data={get value(){reads++;throw Error('missing saved field');}};let error;try{vm.runInNewContext(jsFunctions(text)+'\nsubject(data,true);',{data});}catch(failure){error=failure.message;}return {reads,error};};
 assert.deepEqual(execute(result.source),execute(source));assert.deepEqual(execute(result.source),{reads:1,error:'missing saved field'});assert.equal(result.statistics.noNewReads,true);
});
test('different fields, dynamic limits, method calls and non-string types are never folded',()=>{
 const raws=[
  'data.value is string && data.other.size()>0 && data.value.size()<=200',
  'data.value is string && data.value.size()>minimum && data.value.size()<=200',
  'data.value is string && data.value.size()>0 && data.value.size()<=maximum',
  'data.value is number && data.value>0 && data.value<=200',
  'readValue() is string && readValue().size()>0 && readValue().size()<=200',
  'data.value is string && data.value.length()>0 && data.value.length()<=200'
 ];
 for(const raw of raws){const source=wrap(`function one(data,minimum,maximum){return ${raw};} function two(data,minimum,maximum){return ${raw};}`),result=shareBoundedText(source);assert.equal(result.source,source,raw);}
});
test('unary and arithmetic suffixes are excluded on either side of the complete validation atom',()=>{
 const base=guard('data.value');
 for(const raw of ['!'+base,'other + '+base,base+' + 1',base.replace('<= 200','<= 200+1'),base.replace('data.value is string','data.value is string || other')]){
  const source=wrap(`function one(data,other){return ${raw};} function two(data,other){return ${raw};}`),result=shareBoundedText(source);assert.equal(result.source,source,raw);
 }
});
test('every extended numeric RHS and higher-precedence LHS stays byte-exact, including optional single-bound mode',()=>{
 const base=guard('data.value'),raws=[
  '!'+base,'-data.value is string && data.value.size()>0 && data.value.size()<=200',
  'other * '+base,'other == '+base,'other < '+base,
  base.replace('<= 200','<= 200-1'),base.replace('<= 200','<= 200*2'),base.replace('<= 200','<= 200/2'),
  base.replace('<= 200','<= 2e2+1'),base.replace('<= 200','<= 200[0]'),base.replace('<= 200','<= 200.abs()'),
  base.replace('<= 200','<= 200 == true'),base.replace('> 0','> 0+1'),base.replace('<= 200','<= (other ? 200 : 300)'),
  base.replace('<= 200','<= 200 | other')
 ];
 for(const raw of raws){const source=wrap(`function subject(data,other){return ${raw};} function otherCheck(data,other){return ${raw};}`);for(const includeSingleBounds of [false,true])assert.equal(shareBoundedText(source,{includeSingleBounds}).source,source,raw);}
});
test('complete AND subchains preserve surrounding OR, grouping and ternary-condition precedence in actual functions',()=>{
 for(const expression of [
  `${guard('data.value','0','4')} || gate`,
  `gate || ${guard('data.value','0','4')}`,
  `(${guard('data.value','0','4')}) && gate`,
  `${guard('data.value','0','4')} ? true : gate`,
  `gate ? (${guard('data.value','0','4')}) : false`
 ]){
  const source=wrap(`function subject(data,gate){return ${expression};} function other(data,gate){return ${expression};}`),result=shareBoundedText(source);
  assert.equal(result.proof.sites.length,2,expression);assertRequestIndependent(source,result);
  for(const value of ['', 'a','abcde',null,12])for(const gate of [true,false]){const before=evaluate(source,value,gate),after=evaluate(result.source,value,gate);assert.equal(after.result,before.result,expression);assert.equal(after.error,before.error,expression);}
 }
});
test('grouped atoms, ternary branches, let assignments and array/map values retain original placement',()=>{
 for(const body of [`return !(${guard('data.value')});`,`return gate ? (${guard('data.value')}) : false;`,`let result=${guard('data.value')};return result;`,`return [(${guard('data.value')})];`,`return {'ok':(${guard('data.value')})};`]){
  const source=wrap(`function one(data,gate){${body}} function two(data,gate){${body}}`),result=shareBoundedText(source);assert.equal(result.proof.sites.length,2);assertRequestIndependent(source,result);
 }
});
test('comments and exact operand spelling survive inverse restoration while strings remain opaque',()=>{
 const raw='data /*immutable*/ . value is string && data /*same*/ . value.size()>0 && data . value.size()<=200',source=wrap(`function one(data){return ${raw};} function two(data){return ${raw};} function text(){return "${guard('data.value')}";}`),result=shareBoundedText(source);
 assert.equal(result.proof.sites.length,2);assert.match(result.source,/\/\*immutable\*\//);assertRequestIndependent(source,result);
});
test('fresh helper/value/bound names cannot capture existing source bindings',()=>{
 const source=fixture().replace('subject(data,gate)','subject(data,gate,boundedTextValue,boundedTextLimit0,boundedTextExclusiveRange)'),result=shareBoundedText(source),helper=result.proof.helpers[0];
 assert.equal(helper.name,'boundedTextExclusiveRange1');assert.equal(helper.parameters[0],'boundedTextValue1');assert.equal(helper.parameters[1],'boundedTextLimit01');assertRequestIndependent(source,result);
});
test('single max/positive text checks are opt-in and retain their exact comparator and bounds',()=>{
 const raw=wrap('function one(data){return data.value is string && data.value.size()<=300 && data.name is string && data.name.size()>0;} function two(data){return data.value is string && data.value.size()<=1500 && data.name is string && data.name.size()>8;}');
 assert.equal(shareBoundedText(raw).source,raw);const result=shareBoundedText(raw,{includeSingleBounds:true});assert.equal(result.proof.helpers.length,2);assert.equal(result.proof.sites.length,4);assertRequestIndependent(raw,result);
});
test('forged output/proof cannot change type, method, order, inclusivity, literal or field',()=>{
 const source=fixture(),result=shareBoundedText(source);
 for(const bad of [result.source.replace(' is string',' is number'),result.source.replace('.size() >','.size() >='),result.source.replace('(data.value)','(data.other)'),result.source.replace('(200)','(201)')]){
  assert.notEqual(bad,result.source);assert.throws(()=>assertBoundedTextSharingEquivalent(source,bad,{...result.proof,loweredSha256:sha(bad)}));
 }
 const proof=structuredClone(result.proof);proof.sites[0].bounds[0]='1';assert.throws(()=>assertBoundedTextSharingEquivalent(source,result.source,proof),/bound/);
});
test('frozen app policy gives44 two-bound sites and60 with explicitly enabled single bounds',()=>{
 const source=fs.readFileSync(new URL('../firestore.policy.rules',import.meta.url),'utf8'),ranges=shareBoundedText(source),all=shareBoundedText(source,{includeSingleBounds:true});
 assert.equal(ranges.proof.sites.length,44);assert.equal(ranges.proof.helpers.length,2);assert.equal(all.proof.sites.length,60);assert.equal(all.proof.helpers.length,4);
 assert.deepEqual(ranges.statistics.byKind,{exclusiveRange:31,inclusiveRange:13,inclusiveMaximum:0,exclusiveMinimum:0});assertRequestIndependent(source,ranges);assertRequestIndependent(source,all);
 assert.equal(fs.readFileSync(new URL('../firestore.policy.rules',import.meta.url),'utf8'),source);
});
