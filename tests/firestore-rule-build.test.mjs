import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {GENERATED_RULES_HEADER,tokenizeRules,buildFirestoreRules,assertRuleBuildEquivalent} from '../tools/build-firestore-rules.mjs';

const fixture=String.raw`rules_version = '2';
// decide() and preparedCancellation() must stay readable in comments.
service cloud.firestore {
  match /databases/{database}/documents {
    function decide(data) {
      let text = "decide() and \"preparedCancellation()\"";
      return preparedCancellation(data) && data.preparedCancellation == true
        && data.decide() && get(/databases/$(database)/documents/decide/$(data.id)).data.get('decide', false);
    }
    /* A block comment containing function ignored() and decide(). */
    function preparedCancellation(data) { return data.get('preparedCancellation', false); }
    match /decide/{decide} { allow get: if decide(resource.data); }
  }
}`;
const buildFile=fileURLToPath(new URL('../tools/build-firestore-rules.mjs',import.meta.url));
function tempFixture(callback){
 const directory=mkdtempSync(join(tmpdir(),'takodeal-rule-build-'));
 try{return callback(directory);}finally{
  // The recursive cleanup target is exactly the newly created named temp
  // directory, never a computed ancestor or an arbitrary external path.
  const target=resolve(directory),base=resolve(tmpdir());
  if(dirname(target)!==base||!basename(target).startsWith('takodeal-rule-build-'))throw Error('Refusing an unsafe temporary cleanup target.');
  rmSync(target,{recursive:true,force:true});
 }
}
const cli=(args,cwd)=>spawnSync(process.execPath,[buildFile,...args],{cwd,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024*1024});
const parameter=(built,helper,index=0)=>built.source.match(new RegExp('function '+new Map(built.mapping).get(helper)+'\\(([^)]*)\\)'))[1].split(',')[index].trim();

test('lexer retains every byte and treats strings, escaped quotes and comments as opaque tokens',()=>{
 const source=fixture.replaceAll('\n','\r\n')+'\r\n// Unicode text: ₱ and café\r\n',tokens=tokenizeRules(source);assert.equal(tokens.map(token=>token.text).join(''),source);
 assert.ok(tokens.some(token=>token.type==='comment'&&token.text.includes('function ignored()')));assert.ok(tokens.some(token=>token.type==='string'&&token.text.includes('preparedCancellation()')));
 for(const token of tokens)assert.equal(source.slice(token.start,token.end),token.text);
});
test('only helper and bound variable sites change; properties, literals, comments and static paths stay exact',()=>{
 const built=buildFirestoreRules(fixture),mapping=new Map(built.mapping),decide=mapping.get('decide'),prepared=mapping.get('preparedCancellation'),data=parameter(built,'decide'),otherData=parameter(built,'preparedCancellation');
 assert.equal(mapping.size,2);assert.equal(built.statistics.calls,2);assert.equal(built.statistics.replacements,4);
 assert.ok(built.source.includes('function '+decide+'('+data+')'));assert.ok(built.source.includes('function '+prepared+'('+otherData+')'));assert.ok(built.source.includes('return '+prepared+'('+data+')'));assert.ok(built.source.includes('allow get: if '+decide+'(resource.data)'));
 for(const original of ['// decide() and preparedCancellation()','function ignored() and decide().',data+'.preparedCancellation == true',data+'.decide()','/documents/decide/$('+data+'.id)','match /decide/{decide}',".get('preparedCancellation', false)",".get('decide', false)"])assert.ok(built.source.includes(original),original);
 assert.deepEqual(assertRuleBuildEquivalent(fixture,built.source,built.mapping),{tokensVerified:tokenizeRules(fixture).length,replacements:4,helpers:2,bindings:3,localReplacements:8});
});
test('new helper names cannot capture existing variables, path segments, properties or other helpers',()=>{
 const source=String.raw`function first(data) { let r0 = 1; let r1 = 2; return r7(data) && data.r2 > r0; }
function r7(data) { return data.get('first', false); }
match /r3/{r4} { allow read: if first(resource.data); }`,built=buildFirestoreRules(source),occupied=new Set(tokenizeRules(source).filter(token=>token.type==='identifier').map(token=>token.text)),names=built.mapping.map(([,name])=>name);
 assert.equal(new Set(names).size,names.length);for(const name of names)assert.equal(occupied.has(name),false);for(const preserved of [' = 1',' = 2','.r2','match /r3/{r4}'])assert.ok(built.source.includes(preserved));
 assert.equal(buildFirestoreRules(source).source,built.source);
});
test('nested unique helper scopes preserve their declaration and call graph without rewriting member calls',()=>{
 const source=`function outer(data){ return data.inner() && inner(data); }
match /items/{id} { function inner(data) { return outer(data); } allow read: if inner(resource.data); }`,built=buildFirestoreRules(source),names=new Map(built.mapping);
 assert.ok(built.source.includes(parameter(built,'outer')+'.inner()'));assert.ok(built.source.includes('return '+names.get('outer')+'('+parameter(built,'inner')+')'));assert.ok(built.source.includes('&& '+names.get('inner')+'('+parameter(built,'outer')+')'));assert.equal(built.statistics.helpers,2);assert.equal(built.statistics.calls,3);
});
test('global built-ins and qualified map methods retain their original names',()=>{
 const source=`function permitted(data) { return exists(/databases/$(database)/documents/items/$(data.id)) && getAfter(/databases/$(database)/documents/items/$(data.id)).data.get('allowed', false) && math.round(data.amount) == int(data.amount); }
allow read: if permitted(resource.data);`,built=buildFirestoreRules(source);
 const data=parameter(built,'permitted');for(const preserved of ['exists(/databases','getAfter(/databases',".data.get('allowed', false)",'math.round('+data+'.amount)','int('+data+'.amount)'])assert.ok(built.source.includes(preserved));
});
test('inverse verification rejects permission, operator, field, path or literal mutations',()=>{
 const built=buildFirestoreRules(fixture),short=new Map(built.mapping).get('preparedCancellation'),data=parameter(built,'decide'),mutations=[
  built.source.replace('== true','!= true'),built.source.replace('allow get:','allow write:'),built.source.replace('/documents/decide/','/documents/cash_accounts/'),built.source.replace("'preparedCancellation'","'differentField'"),built.source.replace(data+'.preparedCancellation',data+'.'+short),built.source.replace('return '+short+'('+data+')','return preparedCancellation('+data+')'),built.source.replace('/* A block comment','/* Altered block comment')
 ];
 for(const altered of mutations){assert.notEqual(altered,built.source);assert.throws(()=>assertRuleBuildEquivalent(fixture,altered,built.mapping),/Rules build/);}
});
test('unsafe mappings, duplicate declarations, built-in shadowing and malformed lexical input stop generation',()=>{
 const built=buildFirestoreRules(fixture);for(const mapping of [[['decide','data'],['preparedCancellation','newName']],[['decide','same'],['preparedCancellation','same']],[['decide','get'],['preparedCancellation','newName']],[['decide','onlyOne']]])assert.throws(()=>assertRuleBuildEquivalent(fixture,built.source,mapping));
 for(const source of ['function duplicate(){return true;} function duplicate(){return false;}','function get(path){return true;}','function (data){return true;}',"function sample(){return 'unterminated;}",'/* unterminated comment','function sample(){return "trailing'+'\\'])assert.throws(()=>buildFirestoreRules(source),/Rules build/);
 assert.throws(()=>buildFirestoreRules(built.source),/previously generated/);
});
test('scoped alpha renaming preserves executed results, free variables, object keys and ternary branches',()=>{
 const policy=`function totalFor(order, rate) {
 let values = {rate: order.rate, order: {rate: rate}};
 let total = order.amount * rate;
 return order.enabled ? total : values.rate + tenant;
}
function combined(order, rate) { let total = totalFor(order, rate); return total + order.rate; }`,built=buildFirestoreRules(policy),helper=new Map(built.mapping).get('combined');
 for(const enabled of [true,false])for(const amount of [0,1,15.5])for(const rate of [0,2,3.25]){
  const input={enabled,amount,rate:7},context={input,rate,tenant:31};
  const original=vm.runInNewContext(policy+'\ncombined(input, rate);',context),generated=vm.runInNewContext(built.source+'\n'+helper+'(input, rate);',context);
  assert.equal(generated,original);
 }
 assert.ok(built.source.includes('{rate: '));assert.ok(built.source.includes('order: {rate: '));assert.ok(built.source.includes(' + tenant'));
 const alias=parameter(built,'totalFor');assert.match(alias,/^[A-Za-z_]$/);assert.notEqual(alias,'order');assert.equal(parameter(built,'combined'),alias,'separate function scopes may reuse the same fresh alias');
});
test('type names, member names and map keys remain literal even when they name local bindings',()=>{
 const policy=`function inspect(map) { let value = map; return map is map && value.map == map && {map: map, 'map': map, nested: {value: value}}.map == map; }`,built=buildFirestoreRules(policy),map=parameter(built,'inspect'),value=built.source.match(/let ([A-Za-z_]) =/)[1];
 assert.ok(built.source.includes(map+' is map'));assert.ok(built.source.includes(value+'.map == '+map));assert.ok(built.source.includes('{map: '+map+", 'map': "+map+', nested: {value: '+value+'}}.map == '+map));
 assert.equal(assertRuleBuildEquivalent(policy,built.source,built.mapping).bindings,2);
});
test('path-valued locals retain static segments while local interpolation, member receivers and arithmetic division rename',()=>{
 const policy=`function inspect(id, map, path) {
 let document = /databases/$(database)/documents/path/$(id);
 let portion = id / 2;
 return get(/databases/$(database)/documents/map/$(map.id)).data.id == id
   && get(document).data.path == path && (true ? id : map.id) == portion;
}`,built=buildFirestoreRules(policy),id=parameter(built,'inspect',0),map=parameter(built,'inspect',1),path=parameter(built,'inspect',2);
 assert.ok(built.source.includes('/databases/$(database)/documents/path/$('+id+')'));
 assert.ok(built.source.includes('/databases/$(database)/documents/map/$('+map+'.id)'));
 assert.ok(built.source.includes(' = '+id+' / 2;'));assert.ok(built.source.includes('.data.id == '+id));assert.ok(built.source.includes('.data.path == '+path));assert.ok(built.source.includes('(true ? '+id+' : '+map+'.id)'));
});
test('nested path interpolations preserve inner literal segments without leaving bound arguments unrenamed',()=>{
 const policy=`function inspect(id) { return get(/databases/$(database)/documents/id/$(get(/databases/$(database)/documents/id/$(id)).data.id)).data.id == id; }`,built=buildFirestoreRules(policy),id=parameter(built,'inspect');
 assert.equal(built.source.split('/documents/id/').length-1,2);assert.ok(built.source.includes('/documents/id/$('+id+')'));assert.ok(built.source.includes(')).data.id == '+id));assert.equal(assertRuleBuildEquivalent(policy,built.source,built.mapping).bindings,1);
});
test('complete hyphenated, dotted and numeric literal path segments are preserved, including local-name suffixes',()=>{
 for(const segment of ['owner-id','raw-segment','2026-id','id-2026-map','tenant.id','123']){
  const policy=`function inspect(id,segment,map) { return exists(/databases/$(database)/documents/${segment}/$(id)); }`,built=buildFirestoreRules(policy),id=parameter(built,'inspect');
  assert.ok(built.source.includes('/documents/'+segment+'/$('+id+')'),segment);assert.equal(assertRuleBuildEquivalent(policy,built.source,built.mapping).bindings,3);
 }
 const nested='function inspect(id) { return exists(/databases/$(database)/documents/owner-id/$(get(/databases/$(database)/documents/owner-id/$(id)).data.id)); }',built=buildFirestoreRules(nested);assert.equal(built.source.split('/documents/owner-id/').length-1,2);
});
test('unsupported embedded path segments fail closed instead of reclassifying their suffix as a local',()=>{
 for(const segment of ['owner$(id)','$(id)-id','owner@id'])assert.throws(()=>buildFirestoreRules(`function inspect(id) { return exists(/databases/$(database)/documents/${segment}); }`),/literal path/);
});
test('all local aliases are fresh against every original identifier and unique within each function',()=>{
 const policy=`match /items/{a} { function inspect(data, row) { let amount = data.a + row.b; let another = amount + c; return another + d; } allow read: if inspect(resource.data, resource.data); }`,built=buildFirestoreRules(policy),occupied=new Set(tokenizeRules(policy).filter(token=>token.type==='identifier').map(token=>token.text)),aliases=[...built.source.matchAll(/(?:function r\w+\(([^)]+)\)|let ([A-Za-z_]) =)/g)].flatMap(match=>match[1]?match[1].split(',').map(value=>value.trim()):[match[2]]);
 assert.equal(aliases.length,4);assert.equal(new Set(aliases).size,4);for(const alias of aliases){assert.match(alias,/^[A-Za-z_]$/);assert.equal(occupied.has(alias),false);}assert.ok(built.source.includes(' + c;'));assert.ok(built.source.includes(' + d;'));assert.ok(built.source.includes('match /items/{a}'));
});
test('duplicate, nested, shadowed-helper and ambiguous pre-initializer bindings fail closed',()=>{
 for(const policy of [
  'function inspect(data,data){return data;}',
  'function inspect(data){let data=1;return data;}',
  'function inspect(data){let value=data;let value=2;return value;}',
  'function inspect(data){function nested(){return true;} return data;}',
  'function other(){return true;} function inspect(other){return other();}',
  'function inspect(data){let first=value;let value=data;return first;}',
  'function inspect(data){let value=value;return value;}',
  'function inspect(data){return data; let value=1;}',
  'function inspect(data,){return data;}',
  'function inspect(data){data = true;return data;}'
 ])assert.throws(()=>buildFirestoreRules(policy),/Rules build/,policy);
});
test('inverse proof rejects changed binding edges, local capture, map keys, types and interpolated paths',()=>{
 const policy=`function inspect(map,id) { let value=map; return map is map && value.map == map && {map: id}.map == id && get(/databases/$(database)/documents/map/$(id)).data.id == id; }`,built=buildFirestoreRules(policy),map=parameter(built,'inspect'),id=parameter(built,'inspect',1),value=built.source.match(/let ([A-Za-z_])=/)[1],mutations=[
  built.source.replace('let '+value+'='+map,'let '+value+'='+id),
  built.source.replace('('+map+','+id+')','('+map+','+map+')'),
  built.source.replace(map+' is map',map+' is '+map),
  built.source.replace(value+'.map',value+'.'+map),
  built.source.replace('{map: '+id,'{'+map+': '+id),
  built.source.replace('/documents/map/','/documents/'+map+'/'),
  built.source.replace('/documents/map/$('+id+')','/documents/map/$(database)')
 ];for(const altered of mutations){assert.notEqual(altered,built.source);assert.throws(()=>assertRuleBuildEquivalent(policy,altered,built.mapping),/Rules build/);}
});
test('actual generated Rules exactly match the readable source and round-trip every non-binding token',()=>{
 const policy=readFileSync(new URL('../firestore.policy.rules',import.meta.url),'utf8'),generated=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8'),built=buildFirestoreRules(policy),proof=assertRuleBuildEquivalent(policy,generated,built.mapping);
 assert.equal(generated,built.source);assert.ok(proof.helpers>200);assert.ok(proof.replacements>1000);assert.ok(built.statistics.identifierBytesSaved>12000);assert.ok(Buffer.byteLength(generated)<Buffer.byteLength(policy));
 assert.ok(proof.bindings>700);assert.ok(proof.localReplacements>4500);assert.ok(built.statistics.identifierBytesSaved>34000);
 const originalTokens=tokenizeRules(policy),outputTokens=tokenizeRules(generated.slice(GENERATED_RULES_HEADER.length));assert.deepEqual(outputTokens.filter(token=>['comment','string','whitespace','punctuation'].includes(token.type)).map(token=>[token.type,token.text]),originalTokens.filter(token=>['comment','string','whitespace','punctuation'].includes(token.type)).map(token=>[token.type,token.text]));
 const beforePrepared=originalTokens.filter(token=>token.type==='identifier'&&token.text==='preparedCancellation'),afterPrepared=outputTokens.filter(token=>token.type==='identifier'&&token.text==='preparedCancellation');assert.equal(beforePrepared.length-afterPrepared.length,2);assert.equal(afterPrepared.length,2);
});
test('private cash, Staff and payroll document paths and all permission literals survive generation unchanged',()=>{
 const policy=readFileSync(new URL('../firestore.policy.rules',import.meta.url),'utf8'),generated=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
 for(const path of ['/remittances/{remittanceId}','/branch_schedule_proposals/{proposalId}','/staff_private_documents/{staffId}','/staff_document_config/{id}','/payroll_records/{recordId}','/cash_shortage_reviews/{id}']){assert.ok(policy.includes(path),path);assert.ok(generated.includes(path),path);}
 assert.deepEqual(tokenizeRules(generated.slice(GENERATED_RULES_HEADER.length)).filter(token=>token.type==='string').map(token=>token.text),tokenizeRules(policy).filter(token=>token.type==='string').map(token=>token.text));
});
test('CLI builds deterministically and check mode detects a stale policy or edited generated file without repairing it',()=>tempFixture(directory=>{
 const policy=join(directory,'policy.rules'),output=join(directory,'generated.rules');writeFileSync(policy,fixture);const args=['--policy',policy,'--out',output];
 const built=cli(args,directory);assert.equal(built.status,0,built.stderr);const saved=readFileSync(output,'utf8');assert.equal(cli([...args,'--check'],directory).status,0);
 writeFileSync(output,saved.replace('allow get:','allow write:'));const stale=cli([...args,'--check'],directory);assert.equal(stale.status,1);assert.match(stale.stderr,/stale/);assert.equal(readFileSync(output,'utf8'),saved.replace('allow get:','allow write:'));
 assert.equal(cli(args,directory).status,0);writeFileSync(policy,fixture+'\n// policy changed\n');assert.equal(cli([...args,'--check'],directory).status,1);assert.equal(readFileSync(output,'utf8'),saved);
 assert.equal(cli(args,directory).status,0);assert.equal(cli([...args,'--check'],directory).status,0);
}));
test('CLI refuses to overwrite its readable input and check mode never creates missing output',()=>tempFixture(directory=>{
 const policy=join(directory,'policy.rules'),output=join(directory,'missing.rules');writeFileSync(policy,fixture);
 const same=cli(['--policy',policy,'--out',policy],directory);assert.equal(same.status,1);assert.match(same.stderr,/separate files/);assert.equal(readFileSync(policy,'utf8'),fixture);
 const missing=cli(['--policy',policy,'--out',output,'--check'],directory);assert.equal(missing.status,1);assert.match(missing.stderr,/missing/);
}));
