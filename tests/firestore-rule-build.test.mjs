import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
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

test('lexer retains every byte and treats strings, escaped quotes and comments as opaque tokens',()=>{
 const source=fixture.replaceAll('\n','\r\n')+'\r\n// Unicode text: ₱ and café\r\n',tokens=tokenizeRules(source);assert.equal(tokens.map(token=>token.text).join(''),source);
 assert.ok(tokens.some(token=>token.type==='comment'&&token.text.includes('function ignored()')));assert.ok(tokens.some(token=>token.type==='string'&&token.text.includes('preparedCancellation()')));
 for(const token of tokens)assert.equal(source.slice(token.start,token.end),token.text);
});
test('only helper declarations and unqualified calls change; properties, literals, comments and paths stay exact',()=>{
 const built=buildFirestoreRules(fixture),mapping=new Map(built.mapping),decide=mapping.get('decide'),prepared=mapping.get('preparedCancellation');
 assert.equal(mapping.size,2);assert.equal(built.statistics.calls,2);assert.equal(built.statistics.replacements,4);
 assert.ok(built.source.includes('function '+decide+'(data)'));assert.ok(built.source.includes('function '+prepared+'(data)'));assert.ok(built.source.includes('return '+prepared+'(data)'));assert.ok(built.source.includes('allow get: if '+decide+'(resource.data)'));
 for(const original of ['// decide() and preparedCancellation()','function ignored() and decide().','data.preparedCancellation == true','data.decide()','/documents/decide/$(data.id)','match /decide/{decide}',".get('preparedCancellation', false)",".get('decide', false)"])assert.ok(built.source.includes(original),original);
 assert.deepEqual(assertRuleBuildEquivalent(fixture,built.source,built.mapping),{tokensVerified:tokenizeRules(fixture).length,replacements:4,helpers:2});
});
test('new helper names cannot capture existing variables, path segments, properties or other helpers',()=>{
 const source=String.raw`function first(data) { let r0 = 1; let r1 = 2; return r7(data) && data.r2 > r0; }
function r7(data) { return data.get('first', false); }
match /r3/{r4} { allow read: if first(resource.data); }`,built=buildFirestoreRules(source),occupied=new Set(tokenizeRules(source).filter(token=>token.type==='identifier').map(token=>token.text)),names=built.mapping.map(([,name])=>name);
 assert.equal(new Set(names).size,names.length);for(const name of names)assert.equal(occupied.has(name),false);for(const preserved of ['let r0 = 1','let r1 = 2','data.r2','match /r3/{r4}'])assert.ok(built.source.includes(preserved));
 assert.equal(buildFirestoreRules(source).source,built.source);
});
test('nested unique helper scopes preserve their declaration and call graph without rewriting member calls',()=>{
 const source=`function outer(data){ return data.inner() && inner(data); }
match /items/{id} { function inner(data) { return outer(data); } allow read: if inner(resource.data); }`,built=buildFirestoreRules(source),names=new Map(built.mapping);
 assert.ok(built.source.includes('data.inner()'));assert.ok(built.source.includes('return '+names.get('outer')+'(data)'));assert.ok(built.source.includes('&& '+names.get('inner')+'(data)'));assert.equal(built.statistics.helpers,2);assert.equal(built.statistics.calls,3);
});
test('global built-ins and qualified map methods retain their original names',()=>{
 const source=`function permitted(data) { return exists(/databases/$(database)/documents/items/$(data.id)) && getAfter(/databases/$(database)/documents/items/$(data.id)).data.get('allowed', false) && math.round(data.amount) == int(data.amount); }
allow read: if permitted(resource.data);`,built=buildFirestoreRules(source);
 for(const preserved of ['exists(/databases','getAfter(/databases',".data.get('allowed', false)",'math.round(data.amount)','int(data.amount)'])assert.ok(built.source.includes(preserved));
});
test('inverse verification rejects permission, operator, field, path or literal mutations',()=>{
 const built=buildFirestoreRules(fixture),short=new Map(built.mapping).get('preparedCancellation'),mutations=[
  built.source.replace('== true','!= true'),built.source.replace('allow get:','allow write:'),built.source.replace('/documents/decide/','/documents/cash_accounts/'),built.source.replace("'preparedCancellation'","'differentField'"),built.source.replace('data.preparedCancellation','data.'+short),built.source.replace('return '+short+'(data)','return preparedCancellation(data)'),built.source.replace('/* A block comment','/* Altered block comment')
 ];
 for(const altered of mutations){assert.notEqual(altered,built.source);assert.throws(()=>assertRuleBuildEquivalent(fixture,altered,built.mapping),/Rules build/);}
});
test('unsafe mappings, duplicate declarations, built-in shadowing and malformed lexical input stop generation',()=>{
 const built=buildFirestoreRules(fixture);for(const mapping of [[['decide','data'],['preparedCancellation','newName']],[['decide','same'],['preparedCancellation','same']],[['decide','get'],['preparedCancellation','newName']],[['decide','onlyOne']]])assert.throws(()=>assertRuleBuildEquivalent(fixture,built.source,mapping));
 for(const source of ['function duplicate(){return true;} function duplicate(){return false;}','function get(path){return true;}','function (data){return true;}',"function sample(){return 'unterminated;}",'/* unterminated comment','function sample(){return "trailing'+'\\'])assert.throws(()=>buildFirestoreRules(source),/Rules build/);
 assert.throws(()=>buildFirestoreRules(built.source),/previously generated/);
});
test('actual generated Rules exactly match the readable source and round-trip every non-helper token',()=>{
 const policy=readFileSync(new URL('../firestore.policy.rules',import.meta.url),'utf8'),generated=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8'),built=buildFirestoreRules(policy),proof=assertRuleBuildEquivalent(policy,generated,built.mapping);
 assert.equal(generated,built.source);assert.ok(proof.helpers>200);assert.ok(proof.replacements>1000);assert.ok(built.statistics.identifierBytesSaved>12000);assert.ok(Buffer.byteLength(generated)<Buffer.byteLength(policy));
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
