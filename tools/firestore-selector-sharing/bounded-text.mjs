// Generated-only compiler pass: factor immutable string-validation syntax, not policy.
import {createHash} from 'node:crypto';
import {tokenizeRules,buildFirestoreRulesAlpha as buildFirestoreRules} from '../firestore-rule-core.mjs';
import {selectOutsideFunctions} from './selection-scopes.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const requireProof=(okay,message)=>{if(!okay)throw Error('Bounded-text sharing: '+message);};
const codeOf=source=>tokenizeRules(source).filter(token=>!['whitespace','comment'].includes(token.type));
const same=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
const patterns={
 exclusiveRange:{operators:['>','<='],base:'boundedTextExclusiveRange'},
 inclusiveRange:{operators:['>=','<='],base:'boundedTextInclusiveRange'},
 inclusiveMaximum:{operators:['<='],base:'boundedTextInclusiveMaximum'},
 exclusiveMinimum:{operators:['>'],base:'boundedTextExclusiveMinimum'}
};
function scopeOf(code){
 const pattern=['match','/','databases','/','{','database','}','/','documents','{'],found=[];
 for(let at=0;at<code.length;at++)if(pattern.every((token,index)=>code[at+index]?.text===token))found.push(at+pattern.length-1);
 requireProof(found.length===1,'one database documents scope is required.');const open=found[0];let depth=1,end=open+1;
 for(;end<code.length&&depth;end++){if(code[end].text==='{')depth++;else if(code[end].text==='}')depth--;}
 requireProof(depth===0,'documents scope must be balanced.');return {start:code[open].end,end:code[end-1].start};
}
const isPair=(code,at,char)=>code[at]?.text===char&&code[at+1]?.text===char&&code[at].end===code[at+1].start;
function leftBoundary(code,at){
 const previous=code[at-1]?.text;
 return at===0||['return','(','[',',','?',':'].includes(previous)||
  (['&','|'].includes(previous)&&isPair(code,at-2,previous))||
  previous==='='&&code[at-2]?.type==='identifier'&&code[at-3]?.text==='let';
}
function rightBoundary(code,at){return at===code.length||[')',']','}',',',';','?',':'].includes(code[at]?.text)||isPair(code,at,'&')||isPair(code,at,'|');}
function fieldAt(code,at){
 if(code[at]?.type!=='identifier')return null;let end=at+1;
 while(code[end]?.text==='.'&&code[end+1]?.type==='identifier')end+=2;
 return {tokens:code.slice(at,end).map(token=>token.text),end};
}
function numberAt(source,code,at){
 if(!code[at])return null;
 const match=/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(code[at].start));if(!match)return null;
 const finish=code[at].start+match[0].length;let end=at;while(code[end]&&code[end].end<=finish)end++;
 if(code[end-1]?.end!==finish)return null;return {raw:match[0],end};
}
function comparisonAt(source,code,at,field){
 if(!field.every((token,index)=>code[at+index]?.text===token))return null;let end=at+field.length;
 if(!['.','size','(',')'].every((token,index)=>code[end+index]?.text===token))return null;end+=4;
 if(!['<','>'].includes(code[end]?.text))return null;let operator=code[end++].text;
 if(code[end]?.text==='='){if(code[end-1].end!==code[end].start)return null;operator+='=';end++;}
 const constant=numberAt(source,code,end);if(!constant)return null;
 return {operator,bound:constant.raw,end:constant.end};
}
function boundedAt(source,code,at,scope,includeSingleBounds){
 if(!leftBoundary(code,at)||code[at].start<scope.start||code[at].start>=scope.end)return null;
 const field=fieldAt(code,at);if(!field||code[field.end]?.text!=='is'||code[field.end+1]?.text!=='string')return null;
 let end=field.end+2;const comparisons=[];
 while(comparisons.length<2&&isPair(code,end,'&')){
  const next=comparisonAt(source,code,end+2,field.tokens);
  if(!next){
   // Never turn a failed extended/dynamic same-field bound into an eligible
   // single-bound prefix. Unrelated following AND predicates stay outside.
   const prefix=[...field.tokens,'.','size','(',')'];
   if(prefix.every((token,index)=>code[end+2+index]?.text===token))return null;
   break;
  }
  comparisons.push(next);end=next.end;
 }
 if(!comparisons.length||!rightBoundary(code,end))return null;
 const operators=comparisons.map(value=>value.operator),kind=Object.keys(patterns).find(kind=>same(patterns[kind].operators,operators));
 if(!kind||!includeSingleBounds&&operators.length===1)return null;
 return {kind,start:code[at].start,end:code[end-1].end,value:source.slice(code[at].start,code[field.end-1].end),bounds:comparisons.map(value=>value.bound),raw:source.slice(code[at].start,code[end-1].end)};
}
function analyze(source,{includeSingleBounds=false,excludedFunctions=[]}={}){
 requireProof(typeof source==='string','source must be text.');buildFirestoreRules(source);
 const code=codeOf(source),scope=scopeOf(code),sites=[];
 for(let at=0;at<code.length;at++){const site=boundedAt(source,code,at,scope,includeSingleBounds);if(site){sites.push(site);while(code[at+1]?.start<site.end)at++;}}
 return {code,scope,sites:selectOutsideFunctions(source,sites,excludedFunctions)};
}
function fresh(used,base){let name=base,index=0;while(used.has(name))name=base+(++index);used.add(name);return name;}
function declaration(helper){
 const [value,...bounds]=helper.parameters,operators=patterns[helper.kind].operators;
 return `function ${helper.name}(${helper.parameters.join(',')}) { return ${value} is string`+operators.map((operator,index)=>` && ${value}.size() ${operator} ${bounds[index]}`).join('')+'; }';
}
function insertionOf(helpers){return helpers.length?'\n'+helpers.map(helper=>helper.declaration).join('\n')+'\n':'';}
function callOf(site,helper){return `(${helper.name}(${[site.value,...site.bounds].map(value=>'('+value+')').join(',')}))`;}

export function assertBoundedTextSharingEquivalent(original,lowered,proof,options={}){
 requireProof(hash(original)===proof.originalSha256&&hash(lowered)===proof.loweredSha256,'source hashes changed.');
 requireProof(typeof proof.includeSingleBounds==='boolean'&&Number.isSafeInteger(proof.minimumUses)&&proof.minimumUses>=2,'selection settings changed.');
 const analysis=analyze(original,{includeSingleBounds:proof.includeSingleBounds,excludedFunctions:proof.excludedFunctions||[]}),newScope=scopeOf(codeOf(lowered)),occupied=new Set(analysis.code.filter(token=>token.type==='identifier').map(token=>token.text)),byKind=new Map();
 for(const helper of proof.helpers){
  requireProof(patterns[helper.kind]&&!byKind.has(helper.kind)&&helper.parameters.length===patterns[helper.kind].operators.length+1,'helper pattern or arity changed.');
  for(const name of [helper.name,...helper.parameters]){requireProof(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)&&!occupied.has(name),'a new binding is not fresh.');occupied.add(name);}
  requireProof(helper.declaration===declaration(helper),'the exact string type, size methods, order or operators changed.');byKind.set(helper.kind,helper);
 }
 const expectedSites=analysis.sites.filter(site=>analysis.sites.filter(other=>other.kind===site.kind).length>=proof.minimumUses);
 requireProof(proof.helpers.length===new Set(expectedSites.map(site=>site.kind)).size&&proof.sites.length===expectedSites.length,'eligible pattern coverage changed.');
 for(let index=0;index<expectedSites.length;index++){
  const expected=expectedSites[index],site=proof.sites[index],helper=byKind.get(expected.kind);
  requireProof(helper&&['kind','start','end','value','raw'].every(key=>site[key]===expected[key])&&same(site.bounds,expected.bounds),'a value, bound literal, pattern or complete-expression boundary changed.');
  requireProof(site.replacement===callOf(expected,helper),'value evaluation order, constant arguments or atom boundaries changed.');
 }
 requireProof(proof.insertionOffset===analysis.scope.start&&proof.insertion===insertionOf(proof.helpers)&&lowered.slice(newScope.start,newScope.start+proof.insertion.length)===proof.insertion,'helper insertion changed.');
 let restored=lowered.slice(0,newScope.start)+lowered.slice(newScope.start+proof.insertion.length),shift=0,locations=[];
 for(const site of proof.sites){const start=site.start+shift;requireProof(restored.slice(start,start+site.replacement.length)===site.replacement,'a lowered call moved or its exact operands changed.');locations.push({start,end:start+site.replacement.length,raw:site.raw});shift+=site.replacement.length-(site.end-site.start);}
 for(const location of locations.reverse())restored=restored.slice(0,location.start)+location.raw+restored.slice(location.end);
 requireProof(restored===original,'inverse expansion did not recover every original byte.');buildFirestoreRules(lowered);
 if(options.returnSource)return restored;
 return {passed:true,sites:proof.sites.length,helpers:proof.helpers.length,exactInverseBytes:true,exactBoundLiteralTokens:true,exactTypeAndOperators:true,onlyImmutableValueAndLiteralArguments:true,noNewReads:true};
}
export function shareBoundedText(source,{includeSingleBounds=false,minimumUses=2,excludedFunctions=[]}={}){
 requireProof(typeof includeSingleBounds==='boolean'&&Number.isSafeInteger(minimumUses)&&minimumUses>=2,'use boolean single-bounds and at least two uses.');
 const analysis=analyze(source,{includeSingleBounds,excludedFunctions}),used=new Set(analysis.code.filter(token=>token.type==='identifier').map(token=>token.text)),helpers=[];
 for(const [kind,pattern] of Object.entries(patterns))if(analysis.sites.filter(site=>site.kind===kind).length>=minimumUses){
  const name=fresh(used,pattern.base),parameters=[fresh(used,'boundedTextValue'),...pattern.operators.map((_,index)=>fresh(used,'boundedTextLimit'+index))],helper={kind,name,parameters};helper.declaration=declaration(helper);helpers.push(helper);
 }
 const sites=analysis.sites.filter(site=>helpers.some(helper=>helper.kind===site.kind)).map(site=>({...site,replacement:callOf(site,helpers.find(helper=>helper.kind===site.kind))}));
 const insertion=insertionOf(helpers);let lowered=source;
 for(const site of [...sites].reverse())lowered=lowered.slice(0,site.start)+site.replacement+lowered.slice(site.end);
 lowered=lowered.slice(0,analysis.scope.start)+insertion+lowered.slice(analysis.scope.start);
 const proof={version:1,originalSha256:hash(source),loweredSha256:hash(lowered),excludedFunctions:[...excludedFunctions],includeSingleBounds,minimumUses,insertionOffset:analysis.scope.start,insertion,helpers,sites};
 const verified=assertBoundedTextSharingEquivalent(source,lowered,proof);
 return {source:lowered,proof,statistics:{...verified,byKind:Object.fromEntries(Object.keys(patterns).map(kind=>[kind,sites.filter(site=>site.kind===kind).length])),originalBytes:Buffer.byteLength(source),loweredBytes:Buffer.byteLength(lowered)}};
}
