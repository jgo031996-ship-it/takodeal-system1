// Generated-only transparent compiler selector pass. No policy predicate is removed.
import {tokenizeRules} from '../firestore-rule-core.mjs';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw Error('Transparent map methods: '+message);};
const methods=new Set(['affectedKeys','changedKeys','addedKeys','removedKeys']);
const code=source=>tokenizeRules(source).filter(token=>!['whitespace','comment'].includes(token.type));
function parse(source){
 const tokens=code(source),pairs=new Map(),stack=[],functions=[];
 for(let at=0;at<tokens.length;at++){if(['(','[','{'].includes(tokens[at].text))stack.push(at);else if([')',']','}'].includes(tokens[at].text)){const open=stack.pop();if(open==null)fail('unbalanced input');pairs.set(open,at);}}
 if(stack.length)fail('unbalanced input');
 for(let at=0;at<tokens.length;at++)if(tokens[at].text==='function'){
  const paramOpen=at+2,paramEnd=pairs.get(paramOpen),open=paramEnd+1,end=pairs.get(open);
  if(tokens[paramOpen]?.text!=='('||tokens[open]?.text!=='{')fail('unsupported function declaration');
  const bound=new Map(tokens.slice(paramOpen+1,paramEnd).filter(token=>token.type==='identifier').map(token=>[token.text,open]));
  for(let i=open+1;i<end;i++)if(tokens[i].text==='let'){let finish=i+3;while(finish<end&&tokens[finish].text!==';')finish++;if(finish===end)fail('unterminated let');bound.set(tokens[i+1].text,finish);}
  functions.push({name:tokens[at+1].text,start:tokens[at].start,end:tokens[end].end,paramOpen,paramEnd,open,close:end,bound});
 }
 const header='match /databases/{database}/documents {';
 if(source.split(header).length!==2)fail('one canonical outer database scope is required');
 return {source,tokens,pairs,functions,insertion:source.indexOf(header)+header.length};
}
function stringsOnly(tokens){
 if(tokens[0]?.text!=='['||tokens.at(-1)?.text!==']')return false;
 let value=true;for(const token of tokens.slice(1,-1)){if(value){if(token.type!=='string')return false;}else if(token.text!==',')return false;value=!value;}
 return tokens.length===2||!value;
}
function candidates(parsed){
 const {tokens,pairs,source,functions}=parsed,byName=new Map(functions.map(fn=>[fn.name,fn]));
 if(byName.size!==functions.length)fail('ambiguous duplicate helper names');
 const pureLists=new Set();
 for(const fn of functions)if(fn.paramEnd===fn.paramOpen+1&&tokens[fn.open+1]?.text==='return'&&tokens[fn.close-1]?.text===';'&&stringsOnly(tokens.slice(fn.open+2,fn.close-1)))pureLists.add(fn.name);
 const transparent=new Set();
 for(const name of ['newData','oldData']){const fn=byName.get(name);if(fn&&fn.paramEnd===fn.paramOpen+1){const body=tokens.slice(fn.open+1,fn.close).map(token=>token.text).join('');if(body===(name==='newData'?'returnrequest.resource.data;':'returnresource.data;'))transparent.add(name);}}
 function bound(name,at){const fn=functions.find(fn=>fn.start<tokens[at].start&&tokens[at].start<fn.end);return fn?.bound.has(name)&&fn.bound.get(name)<at;}
 function operand(at){
  const first=tokens[at];if(first?.type!=='identifier'||tokens[at-1]?.text==='.')return null;
  let end=at+1;
  if(transparent.has(first.text)&&tokens[end]?.text==='('&&pairs.get(end)===end+1)end+=2;
  else if(!bound(first.text,at)&&!['request','resource'].includes(first.text))return null;
  while(tokens[end]?.text==='.'&&tokens[end+1]?.type==='identifier'&&tokens[end+2]?.text!=='(')end+=2;
  if(['request','resource'].includes(first.text)&&end===at+1)return null;
  return {start:first.start,end:tokens[end-1].end,next:end,text:source.slice(first.start,tokens[end-1].end)};
 }
 const nodes=[];
 for(let at=0;at<tokens.length;at++){
  const left=operand(at);if(!left)continue;let cursor=left.next;
  if(tokens[cursor]?.text!=='.')continue;
  if(tokens[cursor+1]?.text==='diff'&&tokens[cursor+2]?.text==='('){
   const right=operand(cursor+3),close=pairs.get(cursor+2);if(!right||right.next!==close)continue;
   const method=tokens[close+2]?.text;
   if(tokens[close+1]?.text!=='.'||!methods.has(method)||tokens[close+3]?.text!=='('||pairs.get(close+3)!==close+4)continue;
   const end=tokens[close+4].end,original=source.slice(left.start,end),expected=left.text+'.diff('+right.text+').'+method+'()';
   if(original!==expected)continue;
   nodes.push({start:left.start,end,kind:method,arguments:[left.text,right.text],original});
  }else if(tokens[cursor+1]?.text==='keys'&&tokens[cursor+2]?.text==='('&&pairs.get(cursor+2)===cursor+3&&tokens[cursor+4]?.text==='.'&&tokens[cursor+5]?.text==='hasOnly'&&tokens[cursor+6]?.text==='('){
   const open=cursor+6,close=pairs.get(open);if(close==null)continue;const values=tokens.slice(open+1,close);
   const literal=stringsOnly(values),getter=values.length===3&&pureLists.has(values[0].text)&&values[1].text==='('&&values[2].text===')';
   if(!literal&&!getter)continue;
   const list=source.slice(tokens[open+1].start,tokens[close-1].end),end=tokens[close].end,original=source.slice(left.start,end),expected=left.text+'.keys().hasOnly('+list+')';
   if(original!==expected)continue;
   nodes.push({start:left.start,end,kind:'keysOnly',arguments:[left.text,list],original,listKind:literal?'literal strings':'pinned pure constant getter'});
  }
 }
 for(let at=1;at<nodes.length;at++)if(nodes[at-1].end>nodes[at].start)fail('overlapping method chains');
 return {nodes,pureLists:[...pureLists],transparent:[...transparent]};
}
function fresh(occupied,base){let name=base,suffix=0;while(occupied.has(name))name=base+(++suffix);occupied.add(name);return name;}
function eligibleMethods(parsed,nodes,excludedFunctions=[]){
 if(!Array.isArray(excludedFunctions)||excludedFunctions.some(name=>typeof name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))||new Set(excludedFunctions).size!==excludedFunctions.length)fail('excluded function names must be unique identifiers');
 const excluded=new Set(excludedFunctions);
 return nodes.filter(node=>!parsed.functions.some(fn=>excluded.has(fn.name)&&fn.start<node.start&&node.end<fn.end));
}
function block(selectors){return '\n'+selectors.map(selector=>{
 const [left,right]=selector.parameters;
 return '    function '+selector.name+'('+left+','+right+') { return '+left+(selector.kind==='keysOnly'?'.keys().hasOnly('+right+')':'.diff('+right+').'+selector.kind+'()')+'; }';
}).join('\n')+'\n';}
export function assertMapMethodLoweringEquivalent(original,lowered,proof,options={}){
 if(proof?.version!==1||hash(original)!==proof.originalSha256||hash(lowered)!==proof.loweredSha256)fail('source proof differs');
 const old=parse(original),injected=block(proof.selectors),position=old.insertion;
 if(lowered.slice(position,position+injected.length)!==injected)fail('pinned selector body changed');
 const body=lowered.slice(0,position)+lowered.slice(position+injected.length),parsed=parse(body),{tokens,pairs}=parsed,byName=new Map(proof.selectors.map(selector=>[selector.name,selector])),edits=[];
 for(let at=0;at<tokens.length;at++){
  const selector=byName.get(tokens[at].text);if(!selector)continue;
  if(tokens[at-1]?.text==='.'||tokens[at+1]?.text!=='(')fail('selector appears outside its call');
  const open=at+1,close=pairs.get(open),left=open+1,leftEnd=pairs.get(left),comma=leftEnd+1,right=comma+1,rightEnd=pairs.get(right);
  if(tokens[left]?.text!=='('||tokens[comma]?.text!==','||tokens[right]?.text!=='('||rightEnd+1!==close)fail('selector operands or arity changed');
  const a=body.slice(tokens[left].end,tokens[leftEnd].start),b=body.slice(tokens[right].end,tokens[rightEnd].start);
  const restored=a+(selector.kind==='keysOnly'?'.keys().hasOnly('+b+')':'.diff('+b+').'+selector.kind+'()');
  edits.push({start:tokens[at].start,end:tokens[close].end,restored});
 }
 let restored=body;for(const edit of edits.sort((a,b)=>b.start-a.start))restored=restored.slice(0,edit.start)+edit.restored+restored.slice(edit.end);
 if(restored!==original)fail('independent reconstruction changed another source byte');
 const occupied=new Set(old.tokens.filter(token=>token.type==='identifier').map(token=>token.text));
 for(const selector of proof.selectors){if(!methods.has(selector.kind)&&selector.kind!=='keysOnly'||selector.parameters.length!==2)fail('unknown selector semantics');for(const name of [selector.name,...selector.parameters]){if(occupied.has(name)||!/^tkMap[A-Za-z0-9_]*$/.test(name))fail('selector binding collision');occupied.add(name);}}
 const allNodes=candidates(old).nodes,selected=eligibleMethods(old,allNodes,proof.excludedFunctions||[]),eligible=selected.filter(node=>proof.selectors.some(selector=>selector.kind===node.kind));
 if(proof.inlineChains!==allNodes.length-selected.length)fail('inline method occurrence count changed');
 if(eligible.length!==edits.length||proof.calls!==edits.length)fail('method occurrence count changed');
 if(options.returnSource)return restored;
 return {callsVerified:edits.length,allOtherBytesExact:true,pinnedSelectorBodies:true,noNewReads:true,sameErrorDenial:true};
}
export function lowerFirestoreMapMethods(input,{minimumUses=2,excludedFunctions=[]}={}){
 if(typeof input!=='string'||Buffer.byteLength(input)>1024*1024||!Number.isInteger(minimumUses)||minimumUses<1)fail('use a bounded readable Rules source');
 // Methods inside an already shared per-row validator may intentionally stay
 // inline: avoiding another selector call preserves the evaluation budget of
 // the original supported atomic batch while retaining every original check.
 const parsed=parse(input),found=candidates(parsed),selected=eligibleMethods(parsed,found.nodes,excludedFunctions),counts=Object.fromEntries([...methods,'keysOnly'].map(kind=>[kind,selected.filter(node=>node.kind===kind).length])),occupied=new Set(parsed.tokens.filter(token=>token.type==='identifier').map(token=>token.text)),selectors=[];
 for(const kind of [...methods,'keysOnly'])if(counts[kind]>=minimumUses)selectors.push({kind,name:fresh(occupied,'tkMap'+kind[0].toUpperCase()+kind.slice(1)),parameters:[fresh(occupied,'tkMapLeft'+kind),fresh(occupied,'tkMapRight'+kind)]});
 const names=new Map(selectors.map(selector=>[selector.kind,selector.name])),nodes=selected.filter(node=>names.has(node.kind));
 let body=input;for(const node of [...nodes].sort((a,b)=>b.start-a.start))body=body.slice(0,node.start)+names.get(node.kind)+'('+node.arguments.map(argument=>'('+argument+')').join(',')+')'+body.slice(node.end);
 const source=body.slice(0,parsed.insertion)+block(selectors)+body.slice(parsed.insertion),proof={version:1,originalSha256:hash(input),loweredSha256:hash(source),originalBytes:Buffer.byteLength(input),loweredBytes:Buffer.byteLength(source),calls:nodes.length,counts,selectors,minimumUses,excludedFunctions:[...excludedFunctions],inlineChains:found.nodes.length-selected.length,pureListGetters:found.pureLists,transparentDataGetters:found.transparent,operands:'previously bound identifiers/simple fields or pinned transparent oldData/newData selectors',listArguments:'literal string arrays or pinned pure zero-argument list getters',evaluationNotes:['All original receiver and diff argument expressions remain once, in their original order.','Only pure literal/getter string lists may be evaluated before keys(); invalid receiver still denies and no document reads are added.']};
 return {source,proof:{...proof,...assertMapMethodLoweringEquivalent(input,source,proof)}};
}
