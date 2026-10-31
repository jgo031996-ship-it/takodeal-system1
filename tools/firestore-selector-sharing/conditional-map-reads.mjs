// Generated-only reusable selector pass. The readable policy remains unchanged.
import crypto from 'node:crypto';import assert from 'node:assert/strict';
import{tokenizeRules,buildFirestoreRulesAlpha as buildFirestoreRules}from'../firestore-rule-core.mjs';
import {excludedFunctionNames} from './selection-scopes.mjs';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
export function factorConditionalMapReads(input,{excludedFunctions=[]}={}){
 const excluded=excludedFunctionNames(excludedFunctions);
 const code=tokenizeRules(input).filter(t=>!['whitespace','comment'].includes(t.type)),pairs=new Map(),stack=[];
 for(let i=0;i<code.length;i++){if(['(','[','{'].includes(code[i].text))stack.push(i);else if([')',']','}'].includes(code[i].text))pairs.set(stack.pop(),i);}assert.equal(stack.length,0);
 const names=new Set(code.filter(t=>t.type==='identifier').map(t=>t.text)),fresh=base=>{let name=base,n=0;while(names.has(name))name=base+(++n);names.add(name);return name;};
 const functions=[],scopes=[];for(let i=0;i<code.length;i++){
  if(code[i].text==='function'){const close=pairs.get(i+2),open=close+1,end=pairs.get(open);functions.push({name:code[i+1].text,start:i,open,end,params:new Set(code.slice(i+3,close).filter(t=>t.type==='identifier').map(t=>t.text))});}
  if(code[i].text==='match'){let open=i+1;const captures=[];for(;open<code.length;open++){if(code[open].text!=='{')continue;if(code[open+2]?.text==='}'||code[open+2]?.text==='='){captures.push(code[open+1].text);open=pairs.get(open);continue;}break;}assert.ok(open<code.length);scopes.push({header:code.slice(i,open+1).map(t=>t.text).join(''),open,end:pairs.get(open),captures});}
 }
 const declarations=fn=>{const map=new Map();for(let i=fn.open+1;i<fn.end;i++)if(code[i].text==='let'){let end=i+3;while(end<fn.end&&code[end].text!==';')end++;assert.ok(end<fn.end);map.set(code[i+1].text,{start:i,end,valueStart:i+3,valueEnd:end});}return map;};
 const matches=[];for(let i=0;i<code.length;i++){
  const guarded=code[i]?.type==='identifier'&&['&','&','exists','('].every((v,j)=>code[i+1+j]?.text===v)&&code[i+5]?.type==='identifier'&&[')','?','get','('].every((v,j)=>code[i+6+j]?.text===v)&&code[i+10]?.text===code[i+5].text&&[')','.','data',':','{','}'].every((v,j)=>code[i+11+j]?.text===v);
  const plain=!guarded&&code[i]?.type==='identifier'&&['?','get','('].every((v,j)=>code[i+1+j]?.text===v)&&code[i+4]?.type==='identifier'&&[')','.','data',':','{','}'].every((v,j)=>code[i+5+j]?.text===v);
  if(!guarded&&!plain)continue;
  // A complete let initializer / return expression only. Never select an inner
  // suffix of !x, x||y, another ternary or an already-rewritten helper body.
  const before=code[i-1]?.text,assignment=before==='='&&code[i-3]?.text==='let';if(!assignment&&before!=='return')continue;
  const fn=functions.find(f=>f.open<i&&i<f.end);if(!fn||excluded.has(fn.name))continue;const locals=declarations(fn),condition=code[i].text,recordPath=code[i+(guarded?5:4)].text,end=i+(guarded?16:10);
  if(code[end+1]?.text!==';')continue;
  const bound=name=>fn.params.has(name)||locals.has(name)&&locals.get(name).end<i;
  if(!bound(condition)||!bound(recordPath))continue;
  matches.push({kind:guarded?'guarded':'plain',fn,locals,condition,recordPath,start:i,end});i=end;
 }
 const root='match /databases/{database}/documents {';assert.equal(input.split(root).length,2);const insertion=input.indexOf(root)+root.length,edits=[],definitions=[],proof=[],hqGroups=new Map();
 for(const match of matches){const declaration=match.locals.get(match.recordPath);let hq=false,key,initializer;
  if(match.kind==='guarded'&&declaration){
   const value=code.slice(declaration.valueStart,declaration.valueEnd),hqLiteral=value.filter(t=>t.type==='string'&&/^['"]hq_email_access['"]$/.test(t.text)).length,rawHQ=value.filter(t=>t.type==='identifier'&&t.text==='hq_email_access').length;
   const uses=code.slice(match.fn.open+1,match.fn.end).map((t,j)=>({token:t,at:match.fn.open+1+j})).filter(({token,at})=>token.type==='identifier'&&token.text===match.recordPath&&code[at-1]?.text!=='.'&&!(code[at+1]?.text===':'&&['{',','].includes(code[at-1]?.text)));
   // The path is already evaluated in a previous let, and is used ONLY by its
   // declaration and these two exact exists/get arguments. No alias escapes.
   if(hqLiteral+rawHQ===1&&uses.length===3&&uses.map(x=>x.at).sort((a,b)=>a-b).join(',')===[declaration.start+1,match.start+5,match.start+10].sort((a,b)=>a-b).join(',')){
    const candidates=[...match.fn.params,...match.locals.keys()].filter(name=>name!==match.recordPath&&name!==match.condition&&value.some(t=>t.type==='identifier'&&t.text===name));
    if(candidates.length===1){const email=candidates[0];if(match.fn.params.has(email)||match.locals.get(email)?.end<declaration.start){
     // Only the exact direct constructor may be moved. A future initializer
     // with another captured variable or a locally scoped callee stays put.
     const exactPath=['/','databases','/','$','(','database',')','/','documents','/','hq_email_access','/','$','(',email,')'];
     const safeScope=!scopes.some(scope=>scope.open<match.fn.start&&match.fn.end<scope.end&&scope.header!=='match/databases/{database}/documents{'&&scope.captures.includes('database'));
     if(value.length===exactPath.length&&exactPath.every((token,at)=>value[at].text===token)&&safeScope&&!match.fn.params.has('database')&&!match.locals.has('database')){
      const start=code[declaration.valueStart].start,end=code[declaration.valueEnd].start;initializer=input.slice(start,end);const emailSites=value.filter(t=>t.type==='identifier'&&t.text===email&&code[code.indexOf(t)-1]?.text!=='.');
      if(emailSites.length===1){const site=emailSites[0];initializer=initializer.slice(0,site.start-start)+'_email'+initializer.slice(site.end-start);key=tokenizeRules(initializer).filter(t=>t.type!=='whitespace').map(t=>t.text).join('\u0000');
       if(!hqGroups.has(key)){const name=fresh('sharedHQGrant');hqGroups.set(key,{name,initializer});definitions.push(`function ${name}(_eligible,_email) { let _recordPath = ${initializer}; return _eligible && exists(_recordPath) ? get(_recordPath).data : {}; }`);}
       const group=hqGroups.get(key);edits.push({start:code[declaration.start].start,end:code[declaration.end].end,replacement:'',kind:'remove-exclusive-HQ-path-let'});match.replacement=`${group.name}(${match.condition},${email})`;hq=true;proof.push({kind:'HQ path + guarded map',function:match.fn.name,path:match.recordPath,condition:match.condition,email,selector:group.name,pathHasNoOutsideUses:true,constructorAlwaysEvaluated:true});
      }
     }
    }}
   }
  }
  match.hq=hq;
 }
 const remaining=matches.filter(m=>!m.hq);for(const kind of ['guarded','plain']){const group=remaining.filter(m=>m.kind===kind);if(group.length<2)continue;const name=fresh(kind==='guarded'?'sharedGuardedMap':'sharedPresentMap');definitions.push(kind==='guarded'?`function ${name}(_eligible,_recordPath) { return _eligible && exists(_recordPath) ? get(_recordPath).data : {}; }`:`function ${name}(_present,_recordPath) { return _present ? get(_recordPath).data : {}; }`);for(const match of group){match.replacement=`${name}(${match.condition},${match.recordPath})`;proof.push({kind:kind+' map',function:match.fn.name,condition:match.condition,path:match.recordPath,selector:name,argumentsPreviouslyBound:true});}}
 for(const match of matches)if(match.replacement)edits.push({start:code[match.start].start,end:code[match.end].end,replacement:match.replacement,kind:'map-selector-call'});
 if(definitions.length)edits.push({start:insertion,end:insertion,replacement:'\n    '+definitions.join('\n    ')+'\n',kind:'fresh-pinned-selector-declarations'});
 edits.sort((a,b)=>a.start-b.start||a.end-b.end);for(let i=1;i<edits.length;i++)assert.ok(edits[i-1].end<=edits[i].start,'No overlapping transform');
 let result='',cursor=0;const inverse=[];for(const edit of edits){result+=input.slice(cursor,edit.start);const start=result.length;result+=edit.replacement;inverse.push({start,end:result.length,original:input.slice(edit.start,edit.end)});cursor=edit.end;}result+=input.slice(cursor);let restored=result;for(const edit of inverse.reverse())restored=restored.slice(0,edit.start)+edit.original+restored.slice(edit.end);assert.equal(restored,input,'Every original byte must be recoverable exactly');
 return{policy:result,proof:{inputSha256:sha(input),policySha256:sha(result),excludedFunctions:[...excludedFunctions],exactInverseBytes:true,inverseEdits:inverse,census:{guarded:matches.filter(m=>m.kind==='guarded').length,plain:matches.filter(m=>m.kind==='plain').length,hqCandidates:matches.filter(m=>m.hq).length},selectors:definitions,substitutions:proof,rolePredicatesUnchanged:true,noUnconditionalDocumentReads:true,candidateChanged:false,liveOperations:false}};
}

export function assertConditionalMapReadsEquivalent(original,lowered,proof,options={}) {
 const expected=factorConditionalMapReads(original,{excludedFunctions:proof.excludedFunctions||[]});
 assert.equal(expected.policy,lowered,'Conditional read source differs');
 assert.deepEqual(proof,expected.proof,'Conditional read proof differs');
 let restored=lowered;
 for(const edit of proof.inverseEdits)restored=restored.slice(0,edit.start)+edit.original+restored.slice(edit.end);
 assert.equal(restored,original,'Conditional read inverse differs');
 return options.returnSource?restored:{passed:true,exactInverseBytes:true,rolePredicatesUnchanged:true};
}
