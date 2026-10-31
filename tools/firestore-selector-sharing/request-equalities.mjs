// Generated-only, composable Rules compiler pass; the readable app policy is untouched.
import {createHash} from 'node:crypto';
import {tokenizeRules,buildFirestoreRulesAlpha as buildFirestoreRules} from '../firestore-rule-core.mjs';
import {selectOutsideFunctions} from './selection-scopes.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const ensure=(okay,message)=>{if(!okay)throw Error('Request-equality lowering: '+message);};
const codeOf=source=>tokenizeRules(source).filter(token=>!['whitespace','comment'].includes(token.type));
const SELECTORS={
 reqUid:{body:['request','.','auth','.','uid'],getter:'request.auth.uid',base:'requestUidEquals'},
 reqEmail:{body:['request','.','auth','.','token','.','email'],getter:'request.auth.token.email',base:'requestEmailEquals'},
 reqTime:{body:['request','.','time'],getter:'request.time',base:'requestTimeEquals'}
};
const same=(a,b)=>a.length===b.length&&a.every((part,index)=>part===b[index]);
function delimiters(code){
 const stack=[],pairs=new Map(),closing={')':'(',']':'[','}':'{'};
 for(let at=0;at<code.length;at++){
  if(['(','[','{'].includes(code[at].text))stack.push(at);
  else if(closing[code[at].text]){const start=stack.pop();ensure(start!=null&&code[start].text===closing[code[at].text],'unbalanced source.');pairs.set(start,at);}
 }
 ensure(stack.length===0,'unbalanced source.');return pairs;
}
function documents(code,pairs){
 const pattern=['match','/','databases','/','{','database','}','/','documents','{'],found=[];
 for(let at=0;at<code.length;at++)if(pattern.every((part,index)=>code[at+index]?.text===part))found.push(at+pattern.length-1);
 ensure(found.length===1,'one exact database documents scope is required.');const open=found[0],close=pairs.get(open);
 ensure(close!=null,'documents scope is unbalanced.');return {open,close,start:code[open].end,end:code[close].start};
}
function selectors(code,pairs,scope){
 const result=new Map();let depth=0;
 for(let at=scope.open+1;at<scope.close;at++){
  const text=code[at].text;
  if(text==='function'&&code[at-1]?.text!=='.'&&SELECTORS[code[at+1]?.text]){
   const name=code[at+1].text;
   ensure(depth===0&&!result.has(name),'request selectors must be unique root helpers.');
   const expected=['function',name,'(',')','{','return',...SELECTORS[name].body,';','}'],end=at+expected.length;
   ensure(same(code.slice(at,end).map(token=>token.text),expected),'request selector body or arity changed: '+name+'.');
   result.set(name,{name,start:at,end:end-1});
  }
  if(text==='{')depth++;else if(text==='}')depth--;
 }
 for(const name of Object.keys(SELECTORS))ensure(result.has(name),'missing pinned root request selector: '+name+'.');
 // A globally unique function name can only be a declaration or an unqualified
 // zero-argument call. Reject params, lets and match captures with that name.
 for(let at=0;at<code.length;at++){
  const token=code[at];if(token.type!=='identifier'||!result.has(token.text)||code[at-1]?.text==='.')continue;
  if(code[at-1]?.text==='function')continue;
  ensure(code[at+1]?.text==='('&&code[at+2]?.text===')','request selector is shadowed or called with arguments: '+token.text+'.');
 }
 return result;
}
const pairOperator=(code,at,char)=>code[at]?.text===char&&code[at+1]?.text===char&&code[at].end===code[at+1].start;
function leftBoundary(code,at){
 const previous=code[at-1]?.text;
 if(at===0||['return','(','[',',','?',':'].includes(previous))return true;
 if((previous==='&'||previous==='|')&&pairOperator(code,at-2,previous))return true;
 // Only an actual let assignment may precede the atom with '='. A suffix of
 // another equality, inequality or relational expression is never selected.
 return previous==='='&&code[at-2]?.type==='identifier'&&code[at-3]?.text==='let';
}
function rightBoundary(code,at){
 if(at===code.length||[')',']','}',',',';','?',':'].includes(code[at]?.text))return true;
 return pairOperator(code,at,'&')||pairOperator(code,at,'|');
}
function equalityAt(source,code,at,scope){
 if(code[at]?.type!=='identifier'||!leftBoundary(code,at)||code[at].start<scope.start||code[at].start>=scope.end)return null;
 let fieldEnd=at+1,fields=0;
 while(code[fieldEnd]?.text==='.'&&code[fieldEnd+1]?.type==='identifier'){fieldEnd+=2;fields++;}
 if(!fields||!pairOperator(code,fieldEnd,'='))return null;
 const selector=code[fieldEnd+2]?.text,end=fieldEnd+5;
 if(!SELECTORS[selector]||code[fieldEnd+3]?.text!=='('||code[fieldEnd+4]?.text!==')'||!rightBoundary(code,end))return null;
 return {selector,start:code[at].start,end:code[end-1].end,field:source.slice(code[at].start,code[fieldEnd-1].end),raw:source.slice(code[at].start,code[end-1].end)};
}
function analyze(source,{excludedFunctions=[]}={}){
 ensure(typeof source==='string','source must be text.');
 // Reuse the existing independent scope checker: it rejects helper-shadowing,
 // duplicate function/let bindings, unsupported declarations and free captures.
 buildFirestoreRules(source);
 const code=codeOf(source),pairs=delimiters(code),scope=documents(code,pairs),pinned=selectors(code,pairs,scope),sites=[];
 for(let at=0;at<code.length;at++){const site=equalityAt(source,code,at,scope);if(site)sites.push(site);}
 return {code,scope,pinned,sites:selectOutsideFunctions(source,sites,excludedFunctions)};
}
function fresh(occupied,base){let name=base,number=0;while(occupied.has(name))name=base+(++number);occupied.add(name);return name;}

export function assertRequestEqualitiesEquivalent(original,lowered,proof,options={}){
 ensure(sha(original)===proof.originalSha256&&sha(lowered)===proof.loweredSha256,'source hashes changed.');
 const analysis=analyze(original,{excludedFunctions:proof.excludedFunctions||[]}),scope=documents(codeOf(lowered),delimiters(codeOf(lowered))),occupied=new Set(analysis.code.filter(token=>token.type==='identifier').map(token=>token.text));
 ensure(proof.insertionOffset===analysis.scope.start&&lowered.slice(scope.start,scope.start+proof.insertion.length)===proof.insertion,'the root declaration insertion changed.');
 const names=new Set(),bySelector=new Map();
 for(const helper of proof.helpers){
  ensure(SELECTORS[helper.selector]&&!bySelector.has(helper.selector),'helper selector was duplicated or altered.');
  ensure(/^[A-Za-z_][A-Za-z0-9_]*$/.test(helper.name)&&!occupied.has(helper.name)&&!names.has(helper.name),'helper name is not fresh.');names.add(helper.name);
  ensure(/^[A-Za-z_][A-Za-z0-9_]*$/.test(helper.parameter)&&!occupied.has(helper.parameter)&&helper.parameter!==helper.name&&!names.has(helper.parameter),'helper parameter is not fresh.');names.add(helper.parameter);
  ensure(helper.getter===SELECTORS[helper.selector].getter&&helper.declaration===`function ${helper.name}(${helper.parameter}) { return ${helper.parameter} == ${helper.getter}; }`,'helper is not exactly the original ordered equality and pinned request getter.');
  bySelector.set(helper.selector,helper);
 }
 ensure(proof.insertion===(proof.helpers.length?'\n'+proof.helpers.map(helper=>helper.declaration).join('\n')+'\n':''),'additional inserted statements were found.');
 ensure(proof.sites.length===analysis.sites.length,'some original eligible equality sites are missing or added.');
 for(let index=0;index<analysis.sites.length;index++){
  const expected=analysis.sites[index],site=proof.sites[index],helper=bySelector.get(expected.selector);
  ensure(helper&&same(Object.keys(expected).sort(),['selector','start','end','field','raw'].sort())&&Object.keys(expected).every(key=>site[key]===expected[key]),'an equality operand, selector or boundary was altered.');
  ensure(site.replacement===`(${helper.name}(${site.field}))`,'call arguments or lexical boundaries changed.');
 }
 const withoutDeclarations=lowered.slice(0,scope.start)+lowered.slice(scope.start+proof.insertion.length),code=codeOf(withoutDeclarations),calls=[];
 for(let at=0;at<code.length;at++)if(names.has(code[at].text)){
  const helper=proof.helpers.find(helper=>helper.name===code[at].text);ensure(helper,'a helper parameter escaped its declaration.');
  ensure(code[at-1]?.text==='('&&code[at+1]?.text==='(','calls must retain complete parenthesized atom boundaries.');
  let end=at+2;while(code[end]?.type==='identifier'||code[end]?.text==='.')end++;
  ensure(code[end]?.text===')'&&code[end+1]?.text===')','calls may contain only the original dotted field.');
  calls.push({helper,start:code[at-1].start,end:code[end+1].end,raw:withoutDeclarations.slice(code[at-1].start,code[end+1].end)});at=end+1;
 }
 ensure(calls.length===proof.sites.length,'new helper calls are missing or added.');
 let inverse=withoutDeclarations;
 for(let index=calls.length-1;index>=0;index--){const call=calls[index],site=proof.sites[index];ensure(call.helper.selector===site.selector&&call.raw===site.replacement,'a lowered call moved to a different field or selector.');inverse=inverse.slice(0,call.start)+site.raw+inverse.slice(call.end);}
 ensure(inverse===original,'inverse expansion did not recover every original byte.');
 buildFirestoreRules(lowered);
 if(options.returnSource)return inverse;
 return {passed:true,exactInverseBytes:true,pinnedGlobalSelectors:true,sameGetterLexicalScope:true,noAdditionalRequestFrame:true,freshNames:true,evaluationOrder:'original field once, then same pinned request getter',helpers:proof.helpers.length,sites:proof.sites.length};
}

export function lowerRequestEqualities(source,{excludedFunctions=[]}={}){
 const analysis=analyze(source,{excludedFunctions}),occupied=new Set(analysis.code.filter(token=>token.type==='identifier').map(token=>token.text)),helpers=[];
 for(const [selector,definition] of Object.entries(SELECTORS))if(analysis.sites.some(site=>site.selector===selector)){
  const name=fresh(occupied,definition.base),parameter=fresh(occupied,'equalityValue'),getter=definition.getter;
  // The new helper and the original zero-argument selector are in the SAME
  // root lexical scope. Its fresh parameter cannot shadow request. Inline the
  // pinned selector return to replace, rather than add, a request call frame.
  helpers.push({selector,name,parameter,getter,declaration:`function ${name}(${parameter}) { return ${parameter} == ${getter}; }`});
 }
 const sites=analysis.sites.map(site=>({...site,replacement:`(${helpers.find(helper=>helper.selector===site.selector).name}(${site.field}))`}));
 const insertion=helpers.length?'\n'+helpers.map(helper=>helper.declaration).join('\n')+'\n':'';
 let lowered=source;for(const site of [...sites].reverse())lowered=lowered.slice(0,site.start)+site.replacement+lowered.slice(site.end);
 lowered=lowered.slice(0,analysis.scope.start)+insertion+lowered.slice(analysis.scope.start);
 const proof={version:1,originalSha256:sha(source),loweredSha256:sha(lowered),excludedFunctions:[...excludedFunctions],insertionOffset:analysis.scope.start,insertion,helpers,sites};
 const verification=assertRequestEqualitiesEquivalent(source,lowered,proof);
 return {source:lowered,proof,statistics:{...verification,bySelector:Object.fromEntries(Object.keys(SELECTORS).map(selector=>[selector,sites.filter(site=>site.selector===selector).length])),originalBytes:Buffer.byteLength(source),loweredBytes:Buffer.byteLength(lowered)}};
}
