// Generated-only compiler-pass prototype. Does not read or change the app candidate.
import {createHash} from 'node:crypto';
import {tokenizeRules} from '../firestore-rule-core.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const check=(condition,message)=>{if(!condition)throw Error('Constant string-array pooling: '+message);};
const tokens=source=>tokenizeRules(source).filter(token=>!['whitespace','comment'].includes(token.type));
function documentScope(source){
 const code=tokens(source),pattern=['match','/','databases','/','{','database','}','/','documents','{'];
 const starts=[];for(let i=0;i<code.length;i++)if(pattern.every((part,at)=>code[i+at]?.text===part))starts.push(i+pattern.length-1);
 check(starts.length===1,'exactly one database documents scope is required.');
 const open=starts[0];let depth=1,end=open+1;for(;end<code.length&&depth;end++){if(code[end].text==='{')depth++;else if(code[end].text==='}')depth--;}
 check(depth===0,'the documents scope must be balanced.');
 return {start:code[open].end,end:code[end-1].start};
}
function literalParts(raw){
 const all=tokenizeRules(raw);if(all.some(token=>token.type==='comment'))return null;
 const code=all.filter(token=>token.type!=='whitespace');if(code[0]?.text!=='['||code.at(-1)?.text!==']')return null;
 const values=[];let at=1;while(at<code.length-1){if(code[at].type!=='string')return null;values.push(code[at++].text);if(at===code.length-1)break;if(code[at++].text!==','||at===code.length-1)return null;}
 return values;
}
function analyze(source,{minimumEntries=4}={}){
 check(typeof source==='string','input must be source text.');
 check(Number.isSafeInteger(minimumEntries)&&minimumEntries>=4,'at least four literal entries are required.');
 const scope=documentScope(source),code=tokens(source),groups=new Map();
 for(let i=0;i<code.length;i++){
  if(code[i].text!=='['||code[i].start<scope.start||code[i].start>=scope.end)continue;
  let at=i+1;const values=[];while(code[at]?.type==='string'){values.push(code[at++].text);if(code[at]?.text!==',')break;at++;}
  if(values.length<minimumEntries||code[at]?.text!==']')continue;
  const raw=source.slice(code[i].start,code[at].end),parts=literalParts(raw);if(!parts)continue;
  const key=JSON.stringify(parts),group=groups.get(key)||{key,values:parts,literal:raw,sites:[]};
  group.sites.push({start:code[i].start,end:code[at].end,raw});groups.set(key,group);
 }
 return {scope,code,groups:[...groups.values()]};
}
export function censusConstantStringArrays(source,options={}){
 return analyze(source,options).groups.filter(group=>group.sites.length>=2).map(group=>({values:group.values,entries:group.values.length,occurrences:group.sites.length,literalBytes:Buffer.byteLength(group.literal),estimatedAliasBytesSaved:(group.sites.length-1)*Buffer.byteLength(group.literal)-group.sites.length*5-40}));
}
export function assertConstantStringArrayPoolingEquivalent(original,lowered,proof,options={}){
 check(hash(original)===proof.originalSha256,'the original source changed.');
 check(hash(lowered)===proof.loweredSha256,'the lowered source changed.');
 const occupied=new Set(tokens(original).filter(token=>token.type==='identifier').map(token=>token.text));
 const originalScope=documentScope(original),loweredScope=documentScope(lowered);
 check(originalScope.start===proof.insertionOffset,'the insertion scope changed.');
 check(lowered.slice(loweredScope.start,loweredScope.start+proof.insertion.length)===proof.insertion,'only the exact constant declarations may be inserted.');
 const names=new Set();for(const group of proof.groups){
  check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(group.name)&&!occupied.has(group.name)&&!names.has(group.name),'a fresh helper name collided.');names.add(group.name);
  check(group.values.length>=4&&JSON.stringify(literalParts(group.literal))===JSON.stringify(group.values),'the pooled value must be the exact ordered string-only list.');
  check(group.declaration===`function ${group.name}() { return ${group.literal}; }`,'constant helpers cannot have parameters, free captures or other statements.');
 }
 check(proof.insertion===(proof.groups.length?'\n'+proof.groups.map(group=>group.declaration).join('\n')+'\n':''),'unreviewed inserted code was found.');
 const removed=lowered.slice(0,loweredScope.start)+lowered.slice(loweredScope.start+proof.insertion.length),code=tokens(removed),calls=[];
 for(let at=0;at<code.length;at++){
  const token=code[at];if(token.type!=='identifier'||!names.has(token.text))continue;
  check(code[at-1]?.text==='('&&code[at+1]?.text==='('&&code[at+2]?.text===')'&&code[at+3]?.text===')','pooled values must use only parenthesized zero-argument calls.');
  calls.push({name:token.text,start:code[at-1].start,end:code[at+3].end});at+=3;
 }
 const sites=[...proof.sites].sort((a,b)=>a.start-b.start);check(calls.length===sites.length,'the number of call sites changed.');
 let restored=removed;
 for(let index=calls.length-1;index>=0;index--){
  const call=calls[index],site=sites[index],group=proof.groups.find(group=>group.name===site.name);
  check(group&&call.name===site.name&&original.slice(site.start,site.end)===site.raw,'a call moved or its original literal changed.');
  check(JSON.stringify(literalParts(site.raw))===JSON.stringify(group.values),'every replacement must have the same exact ordered literal tokens.');
  check(site.start>=originalScope.start&&site.end<=originalScope.end,'a helper was used outside its enclosing documents scope.');
  restored=restored.slice(0,call.start)+site.raw+restored.slice(call.end);
 }
 check(restored===original,'inverse expansion did not recover every original byte.');
 if(options.returnSource)return restored;
 return {passed:true,constantHelpers:proof.groups.length,callSites:sites.length,exactLiteralTokens:true,exactInverseBytes:true,freshNames:true,freeCaptureCount:0};
}
export function poolConstantStringArrays(source,{minimumEntries=4,minimumEstimatedSavings=64}={}){
 check(Number.isFinite(minimumEstimatedSavings)&&minimumEstimatedSavings>=0,'the size threshold must be finite and nonnegative.');
 const analysis=analyze(source,{minimumEntries}),occupied=new Set(analysis.code.filter(token=>token.type==='identifier').map(token=>token.text));
 const chosen=analysis.groups.filter(group=>group.sites.length>=2&&(group.sites.length-1)*Buffer.byteLength(group.literal)-group.sites.length*5-40>=minimumEstimatedSavings);
 let sequence=0;const groups=chosen.map(group=>{let name;do{name='pooledStringArray'+sequence++;}while(occupied.has(name));occupied.add(name);return {name,values:group.values,literal:group.literal,declaration:`function ${name}() { return ${group.literal}; }`};});
 const sites=chosen.flatMap((group,index)=>group.sites.map(site=>({...site,name:groups[index].name}))).sort((a,b)=>a.start-b.start);
 const insertion=groups.length?'\n'+groups.map(group=>group.declaration).join('\n')+'\n':'';
 let lowered=source;for(const site of [...sites].reverse())lowered=lowered.slice(0,site.start)+'('+site.name+'())'+lowered.slice(site.end);
 lowered=lowered.slice(0,analysis.scope.start)+insertion+lowered.slice(analysis.scope.start);
 const proof={version:1,originalSha256:hash(source),loweredSha256:hash(lowered),insertionOffset:analysis.scope.start,insertion,groups,sites};
 const inverse=assertConstantStringArrayPoolingEquivalent(source,lowered,proof);
 return {source:lowered,proof,statistics:{...inverse,repeatedGroups:analysis.groups.filter(group=>group.sites.length>=2).length,originalBytes:Buffer.byteLength(source),loweredBytes:Buffer.byteLength(lowered),estimatedAliasBytesSaved:chosen.reduce((sum,group)=>sum+(group.sites.length-1)*Buffer.byteLength(group.literal)-group.sites.length*5-40,0)}};
}
