import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {buildFirestoreRules,buildFirestoreRulesAlpha,assertRuleBuildEquivalent,lowerFirestoreRuleSelectors,tokenizeRules} from '../tools/build-firestore-rules.mjs';

const requestHelpers=`function reqUid() { return request.auth.uid; }
function reqEmail() { return request.auth.token.email; }
function reqTime() { return request.time; }`;
const fixture=`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents {
${requestHelpers}
function first(data) { return data.name is string && data.name.size() >= 1 && data.name.size() <= 180 && data.owner == reqUid() && exists(/databases/$(database)/documents/items/$(data.id)); }
function second(data) { return data.name is string && data.name.size() >= 1 && data.name.size() <= 180 && data.owner == reqUid(); }
match /items/{id} { allow get: if first(resource.data); allow write: if false; }
} }`;
const order=['conditional-map-reads','constant-string-arrays','document-paths','map-methods','request-equalities','bounded-text','constant-map-gets','bounded-numbers','literal-false-rules'];
function functionsOf(source){
 const code=tokenizeRules(source).filter(token=>!['whitespace','comment'].includes(token.type)),functions=new Map();
 for(let at=0;at<code.length;at++)if(code[at].text==='function'){
  const start=at,name=code[at+1].text;while(code[at]?.text!=='{')at++;const open=at;let depth=1;
  while(depth){at++;if(code[at].text==='{')depth++;else if(code[at].text==='}')depth--;}
  functions.set(name,{raw:source.slice(code[start].start,code[at].end),body:code.slice(open+1,at)});
 }
 return functions;
}
function maxFunctionDepth(source){
 const functions=functionsOf(source),memo=new Map();
 function depth(name,path=[]){
  assert.ok(!path.includes(name),'generated selectors must never introduce recursion');if(memo.has(name))return memo.get(name);
  const body=functions.get(name).body,calls=body.filter((token,at)=>body[at-1]?.text!=='.'&&body[at+1]?.text==='('&&functions.has(token.text));
  const result=1+Math.max(0,...calls.map(token=>depth(token.text,[...path,name])));memo.set(name,result);return result;
 }
 return Math.max(0,...[...functions.keys()].map(name=>depth(name)));
}
function transitiveFunctionNames(source,roots){
 const functions=functionsOf(source),visited=new Set();
 function visit(name){if(visited.has(name))return;assert.ok(functions.has(name),name);visited.add(name);const body=functions.get(name).body;for(let at=0;at<body.length;at++)if(body[at-1]?.text!=='.'&&body[at+1]?.text==='('&&functions.has(body[at].text))visit(body[at].text);}
 for(const name of roots)visit(name);return [...visited];
}

test('the complete compiler applies all proved passes in one deterministic order and reverses every byte',()=>{
 const lowered=lowerFirestoreRuleSelectors(fixture),built=buildFirestoreRules(fixture);assert.equal(lowered.mode,'nine-pass');assert.deepEqual(lowered.stages.map(row=>row.name),order);assert.equal(built.loweredPolicy,lowered.source);assert.equal(built.source,buildFirestoreRules(fixture).source);assert.equal(assertRuleBuildEquivalent(fixture,built.source,built.mapping,{returnSource:true}),fixture);assert.equal(built.statistics.selectorSharing.exactInverseBytes,true);assert.ok(lowered.source.includes('function tkPath'));assert.ok(!lowered.source.includes('allow write: if false;'));
});
test('fragments preserve the independent alpha-only API while a complete unpinned selector source fails closed',()=>{
 const fragment='function subject(data) { return data.id == request.auth.uid; }',built=buildFirestoreRules(fragment);assert.equal(built.source,buildFirestoreRulesAlpha(fragment).source);assert.equal(built.statistics.selectorSharing.mode,'alpha-fragment');assert.equal(built.statistics.selectorSharing.passes,0);assert.throws(()=>buildFirestoreRules(fixture.replace('return request.auth.uid;','return request.auth.token.email;')),/pinned|request/);
});
test('a generated selector mutation or permission change is rejected even with the exact original alpha mapping',()=>{
 const built=buildFirestoreRules(fixture);for(const altered of [built.source.replace('documents/', 'private/'),built.source.replace('allow get:','allow update:'),built.source.replace('>=','>')]){assert.notEqual(altered,built.source);assert.throws(()=>assertRuleBuildEquivalent(fixture,altered,built.mapping));}
});
test('every pipeline stage consumes the preceding proved output without skipping or rewriting intermediate evidence',()=>{
 const built=buildFirestoreRules(fixture);assert.equal(assertRuleBuildEquivalent(fixture,built.source,built.mapping,{returnSource:true}),fixture);assert.equal(built.statistics.selectorSharing.passes,order.length);assert.equal(built.selectorStages.length,order.length);assert.deepEqual(built.selectorStages.map(row=>row.name),order);assert.equal(built.selectorStages[0].input,fixture);assert.equal(built.selectorStages.at(-1).output,built.loweredPolicy);for(let at=1;at<built.selectorStages.length;at++)assert.equal(built.selectorStages[at].input,built.selectorStages[at-1].output);
});

test('new sharing keeps budget-sensitive validators inline and full-policy user-function depth bounded',()=>{
 const policy=readFileSync(new URL('../firestore.policy.rules',import.meta.url),'utf8'),built=buildFirestoreRules(policy),getters=built.selectorStages.find(stage=>stage.name==='constant-map-gets');
 assert.ok(getters.proof.sites.length>=180);assert.ok(getters.proof.helpers.length>=20);
 const before=functionsOf(getters.input),after=functionsOf(getters.output);
 for(const name of ['cashShortagePayrollRow','disciplineReview','disciplineSavedAction','staffRateHQAny','staffRateHQ','staffRateValue','staffRateValid','staffRateMarker','staffRateDatedMarker','staffRateLegacyCorrection','staffRateEvent','staffRateAuditCreateV1','staffRateAuditCreateV2','staffRateAuditCreate','staffRateProfileLink']){
  assert.ok(before.has(name),name);assert.equal(after.get(name)?.raw,before.get(name).raw,name+' must not gain a map-get frame');
 }
 const numbers=built.selectorStages.find(stage=>stage.name==='bounded-numbers'),numberBefore=functionsOf(numbers.input),numberAfter=functionsOf(numbers.output);
 assert.ok(numbers.proof.sites.length>=30);for(const name of numbers.proof.excludedFunctions)assert.equal(numberAfter.get(name)?.raw,numberBefore.get(name)?.raw,name+' must not gain a numeric frame');
 for(const stage of [getters,numbers]){
  const prior=functionsOf(stage.input),next=functionsOf(stage.output),hot=transitiveFunctionNames(stage.input,['selectorHrSanctionsUpdate','selectorPayrollRecordsCreate']);
  assert.ok(hot.includes('disciplineScope'));assert.ok(hot.includes('cashShortagePayrollMetadata'));assert.ok(hot.includes('isOwner'));assert.equal(hot.includes('offlineOwner'),false,'the proved identity wrapper is no longer an extra function frame');
  for(const name of hot){assert.ok(stage.proof.excludedFunctions.includes(name),name+' must be covered transitively');assert.equal(next.get(name)?.raw,prior.get(name).raw,name+' must not gain an expression frame on either maximum-size path');}
 }
 assert.ok(maxFunctionDepth(built.loweredPolicy)<=maxFunctionDepth(policy)+1,'only one terminal selector frame is permitted');
 assert.ok(maxFunctionDepth(built.loweredPolicy)<=10,'keep a substantial margin below the supported20 function frames');
 assert.equal(assertRuleBuildEquivalent(policy,built.source,built.mapping,{returnSource:true}),policy);
});
test('CLI supports the complete selector pipeline and check mode leaves stale or missing output untouched',()=>{
 const directory=mkdtempSync(join(tmpdir(),'takodeal-selector-pipeline-')),policy=join(directory,'policy.rules'),output=join(directory,'generated.rules'),script=fileURLToPath(new URL('../tools/build-firestore-rules.mjs',import.meta.url));
 const run=args=>spawnSync(process.execPath,[script,'--policy',policy,'--out',output,...args],{cwd:directory,windowsHide:true,encoding:'utf8',timeout:15000});
 try{writeFileSync(policy,fixture);const built=run([]);assert.equal(built.status,0,built.stderr);const stats=JSON.parse(built.stdout),saved=readFileSync(output,'utf8');assert.equal(stats.selectorSharing.passes,order.length);assert.equal(run(['--check']).status,0);writeFileSync(output,saved+'\n// stale output\n');assert.equal(run(['--check']).status,1);assert.equal(readFileSync(output,'utf8'),saved+'\n// stale output\n');assert.equal(readFileSync(policy,'utf8'),fixture);}
 finally{const target=resolve(directory),base=resolve(tmpdir());if(dirname(target)!==base||!basename(target).startsWith('takodeal-selector-pipeline-'))throw Error('Unsafe temporary cleanup target.');rmSync(target,{recursive:true,force:true});}
});
