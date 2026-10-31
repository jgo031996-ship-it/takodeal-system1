import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {buildFirestoreRules,buildFirestoreRulesAlpha,assertRuleBuildEquivalent,lowerFirestoreRuleSelectors} from '../tools/build-firestore-rules.mjs';

const requestHelpers=`function reqUid() { return request.auth.uid; }
function reqEmail() { return request.auth.token.email; }
function reqTime() { return request.time; }`;
const fixture=`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents {
${requestHelpers}
function first(data) { return data.name is string && data.name.size() >= 1 && data.name.size() <= 180 && data.owner == reqUid() && exists(/databases/$(database)/documents/items/$(data.id)); }
function second(data) { return data.name is string && data.name.size() >= 1 && data.name.size() <= 180 && data.owner == reqUid(); }
match /items/{id} { allow get: if first(resource.data); allow write: if false; }
} }`;
const order=['conditional-map-reads','constant-string-arrays','document-paths','map-methods','request-equalities','bounded-text','literal-false-rules'];

test('the complete compiler applies all seven proved passes in one deterministic order and reverses every byte',()=>{
 const lowered=lowerFirestoreRuleSelectors(fixture),built=buildFirestoreRules(fixture);assert.equal(lowered.mode,'seven-pass');assert.deepEqual(lowered.stages.map(row=>row.name),order);assert.equal(built.loweredPolicy,lowered.source);assert.equal(built.source,buildFirestoreRules(fixture).source);assert.equal(assertRuleBuildEquivalent(fixture,built.source,built.mapping,{returnSource:true}),fixture);assert.equal(built.statistics.selectorSharing.exactInverseBytes,true);assert.ok(lowered.source.includes('function tkPath'));assert.ok(!lowered.source.includes('allow write: if false;'));
});
test('fragments preserve the independent alpha-only API while a complete unpinned selector source fails closed',()=>{
 const fragment='function subject(data) { return data.id == request.auth.uid; }',built=buildFirestoreRules(fragment);assert.equal(built.source,buildFirestoreRulesAlpha(fragment).source);assert.equal(built.statistics.selectorSharing.mode,'alpha-fragment');assert.equal(built.statistics.selectorSharing.passes,0);assert.throws(()=>buildFirestoreRules(fixture.replace('return request.auth.uid;','return request.auth.token.email;')),/pinned|request/);
});
test('a generated selector mutation or permission change is rejected even with the exact original alpha mapping',()=>{
 const built=buildFirestoreRules(fixture);for(const altered of [built.source.replace('documents/', 'private/'),built.source.replace('allow get:','allow update:'),built.source.replace('>=','>')]){assert.notEqual(altered,built.source);assert.throws(()=>assertRuleBuildEquivalent(fixture,altered,built.mapping));}
});
test('every pipeline stage consumes the preceding proved output without skipping or rewriting intermediate evidence',()=>{
 const built=buildFirestoreRules(fixture);assert.equal(assertRuleBuildEquivalent(fixture,built.source,built.mapping,{returnSource:true}),fixture);assert.equal(built.statistics.selectorSharing.passes,7);assert.equal(built.selectorStages.length,7);assert.deepEqual(built.selectorStages.map(row=>row.name),order);assert.equal(built.selectorStages[0].input,fixture);assert.equal(built.selectorStages.at(-1).output,built.loweredPolicy);for(let at=1;at<built.selectorStages.length;at++)assert.equal(built.selectorStages[at].input,built.selectorStages[at-1].output);
});
test('CLI supports the complete selector pipeline and check mode leaves stale or missing output untouched',()=>{
 const directory=mkdtempSync(join(tmpdir(),'takodeal-selector-pipeline-')),policy=join(directory,'policy.rules'),output=join(directory,'generated.rules'),script=fileURLToPath(new URL('../tools/build-firestore-rules.mjs',import.meta.url));
 const run=args=>spawnSync(process.execPath,[script,'--policy',policy,'--out',output,...args],{cwd:directory,windowsHide:true,encoding:'utf8',timeout:15000});
 try{writeFileSync(policy,fixture);const built=run([]);assert.equal(built.status,0,built.stderr);const stats=JSON.parse(built.stdout),saved=readFileSync(output,'utf8');assert.equal(stats.selectorSharing.passes,7);assert.equal(run(['--check']).status,0);writeFileSync(output,saved+'\n// stale output\n');assert.equal(run(['--check']).status,1);assert.equal(readFileSync(output,'utf8'),saved+'\n// stale output\n');assert.equal(readFileSync(policy,'utf8'),fixture);}
 finally{const target=resolve(directory),base=resolve(tmpdir());if(dirname(target)!==base||!basename(target).startsWith('takodeal-selector-pipeline-'))throw Error('Unsafe temporary cleanup target.');rmSync(target,{recursive:true,force:true});}
});
