import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {GENERATED_RULES_HEADER,tokenizeRules,buildFirestoreRulesAlpha,assertRuleAlphaEquivalent} from './firestore-rule-core.mjs';
import {factorConditionalMapReads,assertConditionalMapReadsEquivalent} from './firestore-selector-sharing/conditional-map-reads.mjs';
import {poolConstantStringArrays,assertConstantStringArrayPoolingEquivalent} from './firestore-selector-sharing/constant-string-arrays.mjs';
import {lowerFirestorePaths,assertPathLoweringEquivalent} from './firestore-selector-sharing/document-paths.mjs';
import {lowerFirestoreMapMethods,assertMapMethodLoweringEquivalent} from './firestore-selector-sharing/map-methods.mjs';
import {lowerRequestEqualities,assertRequestEqualitiesEquivalent} from './firestore-selector-sharing/request-equalities.mjs';
import {shareBoundedText,assertBoundedTextSharingEquivalent} from './firestore-selector-sharing/bounded-text.mjs';
import {lowerLiteralFalseRules,assertLiteralFalseLoweringEquivalent} from './firestore-selector-sharing/literal-false-rules.mjs';
export {GENERATED_RULES_HEADER,tokenizeRules,buildFirestoreRulesAlpha,assertRuleAlphaEquivalent};
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw Error('Rules build: '+message);};
// These existing per-row or wage-audit validators are close to Firestore's
// expression limit at their supported batch size. Retain their original
// expressions instead of adding selector frames; all policy checks stay exact.
const inlineWageFunctions=['staffRateHQAny','staffRateHQ','staffRateValue','staffRateValid','staffRateMarker','staffRateDatedMarker','staffRateLegacyCorrection','staffRateEvent','staffRateAuditCreateV1','staffRateAuditCreateV2','staffRateAuditCreate','staffRateProfileLink'];
const inlinePathFunctions=['readData','nextData','transactionBefore','transactionAfter','staffDeductionAfter','sharedHQGrant','disciplineRelated','disciplineScope','disciplineReview','disciplineChoice','disciplinePolicyRevision',...inlineWageFunctions];
const inlineMapFunctions=['cashShortagePayrollRow','disciplineReview','disciplineSavedAction',...inlineWageFunctions];
const pipeline=[
 {name:'conditional-map-reads',lower:source=>factorConditionalMapReads(source,{excludedFunctions:inlineWageFunctions}),verify:assertConditionalMapReadsEquivalent},
 {name:'constant-string-arrays',lower:poolConstantStringArrays,verify:assertConstantStringArrayPoolingEquivalent},
 {name:'document-paths',lower:source=>lowerFirestorePaths(source,{excludedFunctions:inlinePathFunctions}),verify:assertPathLoweringEquivalent},
 {name:'map-methods',lower:source=>lowerFirestoreMapMethods(source,{excludedFunctions:inlineMapFunctions}),verify:assertMapMethodLoweringEquivalent},
 {name:'request-equalities',lower:source=>lowerRequestEqualities(source,{excludedFunctions:inlineWageFunctions}),verify:assertRequestEqualitiesEquivalent},
 {name:'bounded-text',lower:source=>shareBoundedText(source,{includeSingleBounds:true,excludedFunctions:inlineWageFunctions}),verify:assertBoundedTextSharingEquivalent},
 {name:'literal-false-rules',lower:lowerLiteralFalseRules,verify:assertLiteralFalseLoweringEquivalent}
];
function sharingEligibility(source){
 // Fragments retain the historic pure-alpha API. An eligible complete policy
 // never skips a failing pass: its selector syntax and scope must be proven.
 const code=tokenizeRules(source).filter(token=>!['whitespace','comment'].includes(token.type));
 const names=new Set(code.filter((token,at)=>code[at-1]?.text==='function').map(token=>token.text));
 const canonical=source.split('match /databases/{database}/documents {').length===2;
 return {enabled:canonical&&['reqUid','reqEmail','reqTime'].every(name=>names.has(name)),reason:canonical?'fragment without complete pinned request selectors':'fragment without canonical database scope'};
}
export function lowerFirestoreRuleSelectors(policy){
 // Pass-local validation uses the independent alpha core, not this pipeline.
 buildFirestoreRulesAlpha(policy);
 const eligibility=sharingEligibility(policy),stages=[];let source=policy;
 if(eligibility.enabled)for(const pass of pipeline){
  const input=source,result=pass.lower(input);source=result.source??result.policy;
  if(typeof source!=='string')fail('selector pass did not return source: '+pass.name);
  if(pass.verify(input,source,result.proof,{returnSource:true})!==input)fail('selector inverse differs: '+pass.name);
  stages.push({name:pass.name,input,output:source,proof:result.proof});
 }
 return {source,stages,mode:eligibility.enabled?'seven-pass':'alpha-fragment',reason:eligibility.enabled?null:eligibility.reason};
}
export function assertRuleBuildEquivalent(policy,generated,mappingInput,options={}){
 const shared=lowerFirestoreRuleSelectors(policy);
 let restored=assertRuleAlphaEquivalent(shared.source,generated,mappingInput,{returnSource:true});
 for(const stage of [...shared.stages].reverse())restored=pipeline.find(pass=>pass.name===stage.name).verify(stage.input,restored,stage.proof,{returnSource:true});
 if(restored!==policy)fail('selector and alpha inverses did not recover the readable policy');
 if(options.returnSource)return restored;
 const alpha=assertRuleAlphaEquivalent(shared.source,generated,mappingInput);
 return shared.mode==='alpha-fragment'?alpha:{...alpha,selectorSharing:{mode:shared.mode,passes:shared.stages.length,exactInverseBytes:true,readableSha256:sha(policy),loweredSha256:sha(shared.source),order:shared.stages.map(stage=>stage.name)}};
}
export function buildFirestoreRules(policy){
 const shared=lowerFirestoreRuleSelectors(policy),built=buildFirestoreRulesAlpha(shared.source);
 let restored=assertRuleAlphaEquivalent(shared.source,built.source,built.mapping,{returnSource:true});
 for(const stage of [...shared.stages].reverse())restored=pipeline.find(pass=>pass.name===stage.name).verify(stage.input,restored,stage.proof,{returnSource:true});
 if(restored!==policy)fail('the generated Rules do not round-trip the readable policy');
 return {...built,loweredPolicy:shared.source,selectorStages:shared.stages,statistics:{...built.statistics,sourceBytes:Buffer.byteLength(policy),loweredBytes:Buffer.byteLength(shared.source),selectorSharing:{mode:shared.mode,passes:shared.stages.length,exactInverseBytes:true,reason:shared.reason,readableSha256:sha(policy),loweredSha256:sha(shared.source),order:shared.stages.map(stage=>stage.name)}}};
}
export function runRuleBuild({policyPath=fileURLToPath(new URL('../firestore.policy.rules',import.meta.url)),outputPath=fileURLToPath(new URL('../firestore.rules',import.meta.url)),check=false}={}){
 if(resolve(policyPath)===resolve(outputPath))fail('the readable policy and generated output must be separate files.');
 const policy=readFileSync(policyPath,'utf8'),result=buildFirestoreRules(policy);
 if(check){let saved;try{saved=readFileSync(outputPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;fail('generated Rules are missing. Run node tools/build-firestore-rules.mjs.');}if(saved!==result.source)fail('generated Rules are stale. Run node tools/build-firestore-rules.mjs.');}
 else writeFileSync(outputPath,result.source);
 return {...result.statistics,checked:check,policy:'firestore.policy.rules',generated:'firestore.rules'};
}
function main(args){
 let check=false,policyPath,outputPath;for(let at=0;at<args.length;at++){if(args[at]==='--check')check=true;else if(args[at]==='--policy'&&args[at+1])policyPath=args[++at];else if(args[at]==='--out'&&args[at+1])outputPath=args[++at];else fail('unsupported argument. Use --check, --policy <path> or --out <path>.');}
 console.log(JSON.stringify(runRuleBuild({policyPath,outputPath,check})));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}}
