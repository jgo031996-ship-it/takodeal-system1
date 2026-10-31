// Generated-only generated-only removal of complete literal-false grants.
// Default deny and the OR of all remaining grants retain exactly the same truth.
import {tokenizeRules} from '../firestore-rule-core.mjs';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw Error('Transparent no-op Rules: '+message);};
const methods=new Set(['get','list','read','create','update','delete','write']);
const trivia=source=>tokenizeRules(source).filter(token=>['whitespace','comment'].includes(token.type)).map(token=>token.text).join('');
function scan(source){
 const tokens=tokenizeRules(source).filter(token=>!['whitespace','comment'].includes(token.type)),pairs=new Map(),stack=[],closing={')':'(',']':'[','}':'{'};
 for(let at=0;at<tokens.length;at++){const text=tokens[at].text;if(['(','[','{'].includes(text))stack.push(at);else if(closing[text]){const open=stack.pop();if(open==null||tokens[open].text!==closing[text])fail('unbalanced input');pairs.set(open,at);}}
 if(stack.length)fail('unbalanced input');
 const matches=[],functions=[];
 for(let at=0;at<tokens.length;at++){
  if(tokens[at].text==='match'&&tokens[at-1]?.text!=='.'){
   let open=at+1;
   for(;open<tokens.length;open++){if(tokens[open].text!=='{')continue;if(tokens[open+1]?.type==='identifier'&&(tokens[open+2]?.text==='}'||tokens[open+2]?.text==='=')){open=pairs.get(open);continue;}break;}
   const close=pairs.get(open);if(close==null)fail('unsupported match');
   matches.push({start:tokens[at].start,end:tokens[close].end,open,close,header:tokens.slice(at,open+1).map(token=>token.text).join('')});
  }
  if(tokens[at].text==='function'){const open=pairs.get(at+2)+1,close=pairs.get(open);if(close==null)fail('unsupported function');functions.push({start:tokens[at].start,end:tokens[close].end});}
 }
 const falseAllows=[];
 for(let at=0;at<tokens.length;at++){
  if(tokens[at].text!=='allow'||tokens[at-1]?.text==='.')continue;
  const start=tokens[at].start;
  if(!matches.some(match=>tokens[match.open].end<=start&&start<match.end)||functions.some(fn=>fn.start<start&&start<fn.end))continue;
  let cursor=at+1,expectMethod=true;const selected=[];
  while(cursor<tokens.length){
   if(expectMethod){if(!methods.has(tokens[cursor].text)||selected.includes(tokens[cursor].text))break;selected.push(tokens[cursor].text);expectMethod=false;cursor++;}
   else if(tokens[cursor].text===','){expectMethod=true;cursor++;}
   else break;
  }
  if(!selected.length||expectMethod||tokens[cursor]?.text!==':'||tokens[cursor+1]?.text!=='if'||tokens[cursor+2]?.text!=='false'||tokens[cursor+3]?.text!==';')continue;
  const end=tokens[cursor+3].end;falseAllows.push({kind:'literal-false-allow',start,end,methods:selected,original:source.slice(start,end),replacement:trivia(source.slice(start,end))});
 }
 const emptyMatches=matches.filter(match=>match.close===match.open+1&&match.header!=='match/databases/{database}/documents{').map(match=>({kind:'empty-match',start:match.start,end:match.end,header:match.header,original:source.slice(match.start,match.end),replacement:trivia(source.slice(match.start,match.end))}));
 return {falseAllows,emptyMatches};
}
function apply(current,operation){if(current.slice(operation.start,operation.end)!==operation.original)fail('operation source differs');return current.slice(0,operation.start)+operation.replacement+current.slice(operation.end);}
export function assertLiteralFalseLoweringEquivalent(original,lowered,proof,options={}){
 if(proof?.version!==1||proof.originalSha256!==hash(original)||proof.loweredSha256!==hash(lowered)||!Array.isArray(proof.operations))fail('source proof differs');
 let state=original;
 for(const operation of proof.operations){
  const options=scan(state),eligible=(operation.kind==='literal-false-allow'?options.falseAllows:operation.kind==='empty-match'?options.emptyMatches:[]).find(candidate=>candidate.start===operation.start&&candidate.end===operation.end);
  if(!eligible||eligible.original!==operation.original||eligible.replacement!==operation.replacement)fail('an operation is not a complete literal-false grant or a truly empty match');
  state=apply(state,eligible);
 }
 if(state!==lowered)fail('another source byte changed');
 let restored=lowered;
 for(const operation of [...proof.operations].reverse()){
  if(restored.slice(operation.start,operation.start+operation.replacement.length)!==operation.replacement)fail('inverse trivia differs');
  restored=restored.slice(0,operation.start)+operation.original+restored.slice(operation.start+operation.replacement.length);
 }
 if(restored!==original)fail('independent inverse changed the readable policy');
 if(options.returnSource)return restored;
 return {allOtherBytesExact:true,commentsAndWhitespacePreserved:true,noTrueOrConditionalGrantRemoved:true,noRemainingScopeMoved:true};
}
export function lowerLiteralFalseRules(input,{pruneEmptyMatches=true}={}){
 if(typeof input!=='string'||Buffer.byteLength(input)>1024*1024)fail('use a bounded readable Rules source');
 let source=input;const operations=[];
 for(const operation of scan(source).falseAllows.sort((a,b)=>b.start-a.start)){source=apply(source,operation);operations.push(operation);}
 if(pruneEmptyMatches){let empties=scan(source).emptyMatches;while(empties.length){const operation=empties.sort((a,b)=>b.start-a.start)[0];source=apply(source,operation);operations.push(operation);empties=scan(source).emptyMatches;}}
 const falseAllows=operations.filter(operation=>operation.kind==='literal-false-allow'),emptyMatches=operations.filter(operation=>operation.kind==='empty-match'),statistics={literalFalseAllows:falseAllows.length,emptyMatches:emptyMatches.length,sourceBytesSaved:Buffer.byteLength(input)-Buffer.byteLength(source)};
 const proof={version:1,originalSha256:hash(input),loweredSha256:hash(source),operations,statistics,semantics:'A complete allow:false contributes false to the OR of matching grants; deleting it preserves that OR and default deny. An empty match contains no grant, function, child match or binding use, so deleting only its nontrivia tokens cannot change a surviving scope.'};
 return {source,statistics,proof:{...proof,...assertLiteralFalseLoweringEquivalent(input,source,proof)}};
}
