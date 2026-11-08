// Generated-only sharing of immutable map reads with exact literal defaults.
import {createHash} from 'node:crypto';
import {tokenizeRules,buildFirestoreRulesAlpha} from '../firestore-rule-core.mjs';
import {selectOutsideFunctions} from './selection-scopes.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const requireProof=(okay,message)=>{if(!okay)throw Error('Constant map getters: '+message);};
const codeOf=source=>tokenizeRules(source).filter(token=>!['whitespace','comment'].includes(token.type));
function scopeOf(code){
 const pattern=['match','/','databases','/','{','database','}','/','documents','{'],found=[];
 for(let at=0;at<code.length;at++)if(pattern.every((token,index)=>code[at+index]?.text===token))found.push(at+pattern.length-1);
 requireProof(found.length===1,'one database documents scope is required.');const open=found[0];let depth=1,end=open+1;
 for(;end<code.length&&depth;end++){if(code[end].text==='{')depth++;else if(code[end].text==='}')depth--;}
 requireProof(depth===0,'documents scope must be balanced.');return {start:code[open].end,end:code[end-1].start};
}
function literalAt(source,code,at){
 const token=code[at];if(!token)return null;
 if(token.type==='string'||['null','true','false'].includes(token.text))return {raw:token.text,end:at+1};
 if((token.text==='['&&code[at+1]?.text===']')||(token.text==='{'&&code[at+1]?.text==='}'))return {raw:token.text+code[at+1].text,end:at+2};
 const number=/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(token.start));if(!number)return null;
 const finish=token.start+number[0].length;let end=at;while(code[end]&&code[end].end<=finish)end++;
 return code[end-1]?.end===finish?{raw:number[0],end}:null;
}
function getterAt(source,code,at,scope){
 if(code[at]?.type!=='identifier'||code[at-1]?.text==='.'||code[at].start<scope.start||code[at].start>=scope.end)return null;
 let end=at+1;while(code[end]?.text==='.'&&code[end+1]?.type==='identifier'&&code[end+2]?.text!=='(')end+=2;
 const receiverEnd=end;
 if(!['.','get','('].every((token,index)=>code[end+index]?.text===token)||code[end+3]?.type!=='string'||code[end+4]?.text!==',')return null;
 const key=code[end+3].text,constant=literalAt(source,code,end+5);if(!constant||code[constant.end]?.text!==')')return null;end=constant.end+1;
 return {start:code[at].start,end:code[end-1].end,receiver:source.slice(code[at].start,code[receiverEnd-1].end),key,defaultValue:constant.raw,raw:source.slice(code[at].start,code[end-1].end)};
}
const groupKey=site=>JSON.stringify([site.key,site.defaultValue]);
function analyze(source,{excludedFunctions=[]}={}){
 requireProof(typeof source==='string','source must be text.');buildFirestoreRulesAlpha(source);
 const code=codeOf(source),scope=scopeOf(code),sites=[];
 for(let at=0;at<code.length;at++){const site=getterAt(source,code,at,scope);if(site){sites.push(site);while(code[at+1]?.start<site.end)at++;}}
 return {code,scope,sites:selectOutsideFunctions(source,sites,excludedFunctions)};
}
function fresh(used,base){let name=base,index=0;while(used.has(name))name=base+(++index);used.add(name);return name;}
const declaration=helper=>`function ${helper.name}(${helper.parameter}) { return ${helper.parameter}.get(${helper.key},${helper.defaultValue}); }`;
const insertionOf=helpers=>helpers.length?'\n'+helpers.map(helper=>helper.declaration).join('\n')+'\n':'';
const callOf=(site,helper)=>`(${helper.name}((${site.receiver})))`;
export function assertConstantMapGetsEquivalent(original,lowered,proof,options={}){
 requireProof(proof?.version===1&&hash(original)===proof.originalSha256&&hash(lowered)===proof.loweredSha256,'source hashes changed.');
 requireProof(Number.isSafeInteger(proof.minimumUses)&&proof.minimumUses>=2,'selection settings changed.');
 const analysis=analyze(original,{excludedFunctions:proof.excludedFunctions||[]}),newScope=scopeOf(codeOf(lowered)),occupied=new Set(analysis.code.filter(token=>token.type==='identifier').map(token=>token.text)),groups=new Map();
 for(const helper of proof.helpers){
  const key=groupKey(helper);requireProof(!groups.has(key),'a literal pair was duplicated.');
  for(const name of [helper.name,helper.parameter]){requireProof(/^[A-Za-z_]\w*$/.test(name)&&!occupied.has(name),'a new binding is not fresh.');occupied.add(name);}
  requireProof(helper.declaration===declaration(helper),'the exact get builtin, key or default changed.');groups.set(key,helper);
 }
 const expectedSites=analysis.sites.filter(site=>analysis.sites.filter(other=>groupKey(other)===groupKey(site)).length>=proof.minimumUses);
 requireProof(proof.helpers.length===new Set(expectedSites.map(groupKey)).size&&proof.sites.length===expectedSites.length,'eligible getter coverage changed.');
 for(let index=0;index<expectedSites.length;index++){
  const expected=expectedSites[index],site=proof.sites[index],helper=groups.get(groupKey(expected));
  requireProof(helper&&Object.keys(expected).every(key=>site[key]===expected[key]),'a receiver, key, literal or method boundary changed.');
  requireProof(site.replacement===callOf(expected,helper),'receiver evaluation or atom boundaries changed.');
 }
 requireProof(proof.insertionOffset===analysis.scope.start&&proof.insertion===insertionOf(proof.helpers)&&lowered.slice(newScope.start,newScope.start+proof.insertion.length)===proof.insertion,'helper insertion changed.');
 let restored=lowered.slice(0,newScope.start)+lowered.slice(newScope.start+proof.insertion.length),shift=0;const locations=[];
 for(const site of proof.sites){const start=site.start+shift;requireProof(restored.slice(start,start+site.replacement.length)===site.replacement,'a lowered getter moved or changed.');locations.push({start,end:start+site.replacement.length,raw:site.raw});shift+=site.replacement.length-(site.end-site.start);}
 for(const location of locations.reverse())restored=restored.slice(0,location.start)+location.raw+restored.slice(location.end);
 requireProof(restored===original,'inverse expansion did not recover every original byte.');buildFirestoreRulesAlpha(lowered);
 if(options.returnSource)return restored;
 return {passed:true,sites:proof.sites.length,helpers:proof.helpers.length,exactInverseBytes:true,exactKeyAndDefaultLiterals:true,onlyImmutableReceiverAndLiteralArguments:true,noNewReads:true,sameErrorDenial:true};
}
export function shareConstantMapGets(source,{minimumUses=3,excludedFunctions=[]}={}){
 requireProof(Number.isSafeInteger(minimumUses)&&minimumUses>=2,'use at least two occurrences.');
 const analysis=analyze(source,{excludedFunctions}),used=new Set(analysis.code.filter(token=>token.type==='identifier').map(token=>token.text)),helpers=[];
 for(const site of analysis.sites)if(analysis.sites.filter(other=>groupKey(other)===groupKey(site)).length>=minimumUses&&!helpers.some(helper=>groupKey(helper)===groupKey(site))){const helper={key:site.key,defaultValue:site.defaultValue,name:fresh(used,'constantMapGet'),parameter:fresh(used,'constantMapValue')};helper.declaration=declaration(helper);helpers.push(helper);}
 const sites=analysis.sites.filter(site=>helpers.some(helper=>groupKey(helper)===groupKey(site))).map(site=>({...site,replacement:callOf(site,helpers.find(helper=>groupKey(helper)===groupKey(site)))}));
 const insertion=insertionOf(helpers);let lowered=source;
 for(const site of [...sites].reverse())lowered=lowered.slice(0,site.start)+site.replacement+lowered.slice(site.end);
 lowered=lowered.slice(0,analysis.scope.start)+insertion+lowered.slice(analysis.scope.start);
 const proof={version:1,originalSha256:hash(source),loweredSha256:hash(lowered),excludedFunctions:[...excludedFunctions],minimumUses,insertionOffset:analysis.scope.start,insertion,helpers,sites};
 return {source:lowered,proof,statistics:assertConstantMapGetsEquivalent(source,lowered,proof)};
}
