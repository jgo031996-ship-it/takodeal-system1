import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {tokenizeRules,buildFirestoreRules,assertRuleBuildEquivalent} from '../tools/build-firestore-rules.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),policy=read('firestore.policy.rules'),generated=read('firestore.rules');
const sha=text=>createHash('sha256').update(text).digest('hex');
function helper(source,name){const code=tokenizeRules(source).filter(t=>!['comment','whitespace'].includes(t.type)),at=code.findIndex((t,i)=>t.text==='function'&&code[i+1]?.text===name);assert.ok(at>=0);let open=at+2;while(code[open].text!=='{')open++;let end=open,depth=1;while(depth){end++;if(code[end].text==='{')depth++;else if(code[end].text==='}')depth--;}return source.slice(code[at].start,code[end].end);}
// Pin the exact cebdd/live baseline without depending on Git history in shallow CI.
function restoreBaseline(){
 const owner="function isOwner() {\n      return isSignedIn() && reqEmail() == 'jgo031996@gmail.com';\n    }",offline="function offlineOwner() {\n      return isSignedIn() && request.auth.token.get('email', '') == 'jgo031996@gmail.com'\n        && request.auth.token.get('email_verified', false) == true;\n    }";
 // Compose the exact reviewed broker-cut inverse before proving the original
 // Owner/WiFi boundary against the historical live baseline.
 const cuts=JSON.parse(read('tests/fixtures/compatible-document-gcash-policy-cuts.json'));let stage=policy;
 for(const edit of [...cuts.edits].reverse()){assert.equal(stage.slice(edit.at,edit.at+edit.after.length),edit.after);stage=stage.slice(0,edit.at)+edit.before+stage.slice(edit.at+edit.after.length);}
 assert.equal(sha(stage),'e8346ffd82e8b35f555cc7a97d5b3e442628dc25a0a16c3d63ede294debda728');
 let restored=stage.replace(helper(stage,'isOwner'),owner).replace(helper(stage,'offlineOwner'),offline);
 const start=restored.indexOf('    // Network credentials are separate from the publicly readable branch record.\n'),end=restored.indexOf('    match /settings/{docId} {',start);assert.ok(start>=0&&end>start);restored=restored.slice(0,start)+restored.slice(end);
 const gate=" && (legacyCollection != 'branches' || !newData().keys().hasAny(['wifi']))\n        &&";assert.equal(restored.split(gate).length-1,2);restored=restored.replaceAll(gate,' &&');
 return restored;
}
test('stage starts from exact live89a7 baseline and changes only the reviewed Owner and branch network policy ranges',()=>{
 assert.equal(sha(restoreBaseline()),'c2feb217f0aa5a5b83bd92feeaf787e18bdbfa46b30252c60a5283767bacbcab','all other Staff/Cashier, private vault, financial, attendance and legacy policy bytes stay exact');
});
test('real Owner helpers require exact email, verified email and Google while anonymous accounts remain a safe false',()=>{
 const functions=['isSignedIn','reqVerified','reqProvider','isOwner','offlineOwner'].map(name=>helper(policy,name)).join('\n');
 function decide({uid='synthetic',email,verified,provider}={}){const token={...(email!==undefined?{email}:{}),...(verified!==undefined?{email_verified:verified}:{}),firebase:{sign_in_provider:provider},get(key,fallback){return Object.hasOwn(this,key)?this[key]:fallback;}},context={request:{auth:uid?{uid,token}:null}};return vm.runInNewContext(functions+'; [isOwner(),offlineOwner()]',context);}
 for(const identity of [{uid:null},{provider:'anonymous'},{email:'foreign@example.test',verified:true,provider:'google.com'},{email:'jgo031996@gmail.com',verified:false,provider:'google.com'},{email:'jgo031996@gmail.com',verified:true,provider:'password'},{email:'jgo031996@gmail.com',verified:'true',provider:'google.com'},{email:'JGO031996@gmail.com',verified:true,provider:'google.com'}])assert.deepEqual(Array.from(decide(identity)),[false,false]);
 assert.deepEqual(Array.from(decide({email:'jgo031996@gmail.com',verified:true,provider:'google.com'})),[true,true]);
});
test('public WiFi denial is a conjunction before every existing create/update OR alternative',()=>{
 const gate="(legacyCollection != 'branches' || !newData().keys().hasAny(['wifi']))";
 for(const method of ['create','update']){const allowance=policy.match(new RegExp('allow '+method+': if legacyCandidate\\(legacyCollection\\)[^;]+;'))?.[0];assert.ok(allowance);assert.ok(allowance.indexOf(gate)>0);assert.ok(allowance.indexOf(gate)<allowance.indexOf('&& staffSetup'));assert.ok(allowance.indexOf(gate)<allowance.indexOf("legacyCollection in ["));}
});
test('private network fields are Owner-only, exact and tied to the public postimage without granting deletes',()=>{
 const block=policy.slice(policy.indexOf('    match /branch_private_settings/{id} {'),policy.indexOf('    match /settings/{docId} {'));
 assert.match(block,/allow read: if isOwner\(\)/);assert.match(block,/allow create, update: if isOwner\(\)/);assert.match(block,/hasOnly\(\['branchId','branch','wifi','updatedAt','updatedByUid'\]\).*size\(\) == 5/);
 assert.match(block,/branchId == id/);assert.match(block,/branch == nextData\('branches',id\)\.name/);assert.match(block,/!nextData\('branches',id\)\.keys\(\)\.hasAny\(\['wifi'\]\)/);assert.match(block,/wifi is string && newData\(\)\.wifi\.size\(\) <= 256/);assert.match(block,/updatedAt == request\.time && newData\(\)\.updatedByUid == reqUid\(\)/);assert.match(block,/oldData\(\)\.branchId == id && oldData\(\)\.branch == newData\(\)\.branch/);assert.doesNotMatch(block,/allow delete|isHQUser|verifiedHQ/);
 assert.match(block,/branch is string && newData\(\)\.branch\.size\(\) > 0 && newData\(\)\.branch\.size\(\) <= 128/);
});
test('unchanged compiler reproduces both live baseline and exact stage, with full source inverse proof',()=>{
 const baseline=buildFirestoreRules(restoreBaseline());assert.equal(sha(baseline.source),'89a7f0b95014f8263bbb08cbbbc81f3ec1d936638a40ecb2b9f6b33fc442a42d');
 const stage=buildFirestoreRules(policy);assert.equal(stage.source,generated);assert.equal(assertRuleBuildEquivalent(policy,generated,stage.mapping,{returnSource:true}),policy);
});
