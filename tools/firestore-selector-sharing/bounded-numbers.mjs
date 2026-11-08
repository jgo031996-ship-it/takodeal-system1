// Generated-only sharing of exact immutable numeric type/bound predicates.
import {createHash} from 'node:crypto';
import {tokenizeRules,buildFirestoreRulesAlpha} from '../firestore-rule-core.mjs';
import {selectOutsideFunctions} from './selection-scopes.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const check=(okay,message)=>{if(!okay)throw Error('Bounded-number sharing: '+message);};
const codeOf=source=>tokenizeRules(source).filter(token=>!['whitespace','comment'].includes(token.type));
const equal=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
const patterns={exclusiveInclusive:{operators:['>','<='],suffix:'ExclusiveInclusive'},inclusiveRange:{operators:['>=','<='],suffix:'InclusiveRange'},exclusiveRange:{operators:['>','<'],suffix:'ExclusiveRange'},inclusiveExclusive:{operators:['>=','<'],suffix:'InclusiveExclusive'},exclusiveMinimum:{operators:['>'],suffix:'ExclusiveMinimum'},inclusiveMinimum:{operators:['>='],suffix:'InclusiveMinimum'}};
function scopeOf(code){
 const pattern=['match','/','databases','/','{','database','}','/','documents','{'],found=[];
 for(let at=0;at<code.length;at++)if(pattern.every((value,index)=>code[at+index]?.text===value))found.push(at+pattern.length-1);
 check(found.length===1,'one database documents scope is required.');const open=found[0];let depth=1,end=open+1;
 for(;end<code.length&&depth;end++){if(code[end].text==='{')depth++;else if(code[end].text==='}')depth--;}
 check(depth===0,'documents scope must be balanced.');return{start:code[open].end,end:code[end-1].start};
}
const pair=(code,at,char)=>code[at]?.text===char&&code[at+1]?.text===char&&code[at].end===code[at+1].start;
const leftBoundary=(code,at)=>at===0||['return','(','[',',','?',':'].includes(code[at-1]?.text)||(['&','|'].includes(code[at-1]?.text)&&pair(code,at-2,code[at-1].text))||code[at-1]?.text==='='&&code[at-2]?.type==='identifier'&&code[at-3]?.text==='let';
const rightBoundary=(code,at)=>at===code.length||[')',']','}',',',';','?',':'].includes(code[at]?.text)||pair(code,at,'&')||pair(code,at,'|');
function fieldAt(code,at){if(code[at]?.type!=='identifier')return null;let end=at+1;while(code[end]?.text==='.'&&code[end+1]?.type==='identifier')end+=2;return{tokens:code.slice(at,end).map(token=>token.text),end};}
function numberAt(source,code,at){
 if(!code[at])return null;const match=/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(code[at].start));if(!match)return null;
 const finish=code[at].start+match[0].length;let end=at;while(code[end]&&code[end].end<=finish)end++;if(code[end-1]?.end!==finish)return null;return{raw:match[0],end};
}
function comparisonAt(source,code,at,field){
 if(!field.every((token,index)=>code[at+index]?.text===token))return null;let end=at+field.length;if(!['<','>'].includes(code[end]?.text))return null;let operator=code[end++].text;
 if(code[end]?.text==='='){if(code[end-1].end!==code[end].start)return null;operator+='=';end++;}
 const bound=numberAt(source,code,end);return bound?{operator,bound:bound.raw,end:bound.end}:null;
}
function boundedAt(source,code,at,scope,includeSingleBounds){
 if(!leftBoundary(code,at)||code[at].start<scope.start||code[at].start>=scope.end)return null;
 const field=fieldAt(code,at);if(!field||code[field.end]?.text!=='is'||!['number','int'].includes(code[field.end+1]?.text))return null;
 const type=code[field.end+1].text;let end=field.end+2;const comparisons=[];
 while(comparisons.length<2&&pair(code,end,'&')){
  const next=comparisonAt(source,code,end+2,field.tokens);
  if(!next){if(field.tokens.every((value,index)=>code[end+2+index]?.text===value)&&['<','>'].includes(code[end+2+field.tokens.length]?.text))return null;break;}
  comparisons.push(next);end=next.end;
 }
 if(!comparisons.length||!rightBoundary(code,end))return null;const operators=comparisons.map(value=>value.operator),kind=Object.keys(patterns).find(key=>equal(patterns[key].operators,operators));
 if(!kind||!includeSingleBounds&&operators.length===1)return null;
 return{type,kind,start:code[at].start,end:code[end-1].end,value:source.slice(code[at].start,code[field.end-1].end),bounds:comparisons.map(value=>value.bound),raw:source.slice(code[at].start,code[end-1].end)};
}
function analyze(source,{includeSingleBounds=false,excludedFunctions=[]}={}){
 check(typeof source==='string','source must be text.');buildFirestoreRulesAlpha(source);const code=codeOf(source),scope=scopeOf(code),sites=[];
 for(let at=0;at<code.length;at++){const site=boundedAt(source,code,at,scope,includeSingleBounds);if(site){sites.push(site);while(code[at+1]?.start<site.end)at++;}}
 return{code,scope,sites:selectOutsideFunctions(source,sites,excludedFunctions)};
}
const group=site=>site.type+':'+site.kind;
function fresh(used,base){let result=base,index=0;while(used.has(result))result=base+(++index);used.add(result);return result;}
function declaration(helper){const [value,...limits]=helper.parameters;return `function ${helper.name}(${helper.parameters.join(',')}) { return ${value} is ${helper.type}`+patterns[helper.kind].operators.map((operator,index)=>` && ${value} ${operator} ${limits[index]}`).join('')+'; }';}
const insertionOf=helpers=>helpers.length?'\n'+helpers.map(helper=>helper.declaration).join('\n')+'\n':'';
const callOf=(site,helper)=>`(${helper.name}(${[site.value,...site.bounds].map(value=>'('+value+')').join(',')}))`;
export function assertBoundedNumbersEquivalent(original,lowered,proof,options={}){
 check(hash(original)===proof.originalSha256&&hash(lowered)===proof.loweredSha256,'source hashes changed.');check(typeof proof.includeSingleBounds==='boolean'&&Number.isSafeInteger(proof.minimumUses)&&proof.minimumUses>=2,'selection settings changed.');
 const analysis=analyze(original,{includeSingleBounds:proof.includeSingleBounds,excludedFunctions:proof.excludedFunctions||[]}),scope=scopeOf(codeOf(lowered)),occupied=new Set(analysis.code.filter(token=>token.type==='identifier').map(token=>token.text)),byGroup=new Map();
 for(const helper of proof.helpers){check(['number','int'].includes(helper.type)&&patterns[helper.kind]&&!byGroup.has(group(helper))&&helper.parameters.length===patterns[helper.kind].operators.length+1,'helper type, pattern or arity changed.');for(const name of [helper.name,...helper.parameters]){check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)&&!occupied.has(name),'a new binding is not fresh.');occupied.add(name);}check(helper.declaration===declaration(helper),'exact numeric type, order or operators changed.');byGroup.set(group(helper),helper);}
 const expected=analysis.sites.filter(site=>analysis.sites.filter(other=>group(other)===group(site)).length>=proof.minimumUses);check(proof.helpers.length===new Set(expected.map(group)).size&&proof.sites.length===expected.length,'eligible pattern coverage changed.');
 for(let index=0;index<expected.length;index++){const wanted=expected[index],site=proof.sites[index],helper=byGroup.get(group(wanted));check(helper&&['type','kind','start','end','value','raw'].every(key=>site[key]===wanted[key])&&equal(site.bounds,wanted.bounds),'value, type, literal bounds or complete-expression boundary changed.');check(site.replacement===callOf(wanted,helper),'value evaluation order, literal arguments or atom boundaries changed.');}
 check(proof.insertionOffset===analysis.scope.start&&proof.insertion===insertionOf(proof.helpers)&&lowered.slice(scope.start,scope.start+proof.insertion.length)===proof.insertion,'helper insertion changed.');
 let restored=lowered.slice(0,scope.start)+lowered.slice(scope.start+proof.insertion.length),shift=0;const locations=[];
 for(const site of proof.sites){const start=site.start+shift;check(restored.slice(start,start+site.replacement.length)===site.replacement,'a lowered call moved or its exact operands changed.');locations.push({start,end:start+site.replacement.length,raw:site.raw});shift+=site.replacement.length-(site.end-site.start);}
 for(const location of locations.reverse())restored=restored.slice(0,location.start)+location.raw+restored.slice(location.end);check(restored===original,'inverse expansion did not recover every original byte.');buildFirestoreRulesAlpha(lowered);
 if(options.returnSource)return restored;return{passed:true,sites:proof.sites.length,helpers:proof.helpers.length,exactInverseBytes:true,exactNumericTypes:true,exactBoundLiteralTokens:true,exactOperators:true,onlyImmutableValueAndLiteralArguments:true,noNewReads:true};
}
export function shareBoundedNumbers(source,{includeSingleBounds=false,minimumUses=2,excludedFunctions=[]}={}){
 check(typeof includeSingleBounds==='boolean'&&Number.isSafeInteger(minimumUses)&&minimumUses>=2,'use boolean single-bounds and at least two uses.');const analysis=analyze(source,{includeSingleBounds,excludedFunctions}),used=new Set(analysis.code.filter(token=>token.type==='identifier').map(token=>token.text)),helpers=[];
 for(const type of ['number','int'])for(const [kind,pattern]of Object.entries(patterns))if(analysis.sites.filter(site=>site.type===type&&site.kind===kind).length>=minimumUses){const name=fresh(used,'bounded'+(type==='int'?'Int':'Number')+pattern.suffix),parameters=[fresh(used,'boundedNumericValue'),...pattern.operators.map((_,index)=>fresh(used,'boundedNumericLimit'+index))],helper={type,kind,name,parameters};helper.declaration=declaration(helper);helpers.push(helper);}
 const sites=analysis.sites.filter(site=>helpers.some(helper=>group(helper)===group(site))).map(site=>({...site,replacement:callOf(site,helpers.find(helper=>group(helper)===group(site)))})),insertion=insertionOf(helpers);let lowered=source;
 for(const site of [...sites].reverse())lowered=lowered.slice(0,site.start)+site.replacement+lowered.slice(site.end);lowered=lowered.slice(0,analysis.scope.start)+insertion+lowered.slice(analysis.scope.start);const proof={version:1,originalSha256:hash(source),loweredSha256:hash(lowered),excludedFunctions:[...excludedFunctions],includeSingleBounds,minimumUses,insertionOffset:analysis.scope.start,insertion,helpers,sites},verified=assertBoundedNumbersEquivalent(source,lowered,proof);
 return{source:lowered,proof,statistics:{...verified,byType:{number:sites.filter(site=>site.type==='number').length,int:sites.filter(site=>site.type==='int').length},originalBytes:Buffer.byteLength(source),loweredBytes:Buffer.byteLength(lowered)}};
}
