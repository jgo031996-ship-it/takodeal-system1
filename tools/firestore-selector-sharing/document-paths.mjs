// Generated-only path sharing. Readable predicates and data are never edited.
// The lowering only replaces canonical data-path literals with pure selectors.
import {tokenizeRules} from '../firestore-rule-core.mjs';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw Error('Transparent paths: '+message);};
const canonicalPrefix='/databases/$(database)/documents';
const signature=['/','databases','/','$','(','database',')','/','documents'];
const operandBefore=new Set(['(','[','=',',',':','?','!','&','|','+','-','*','/','%','<','>','return']);
const boundary=new Set([')',']','}',',',';','?','=',':','!','&','|','+','*','%','<','>']);
const code=source=>tokenizeRules(source).filter(token=>!['whitespace','comment'].includes(token.type));
function layout(source){
 const tokens=code(source),pairs=new Map(),stack=[],closer={')':'(',']':'[','}':'{'};
 for(let at=0;at<tokens.length;at++){
  const text=tokens[at].text;
  if(['(','[','{'].includes(text))stack.push(at);
  else if(closer[text]){const open=stack.pop();if(open==null||tokens[open].text!==closer[text])fail('unbalanced expression');pairs.set(open,at);}
 }
 if(stack.length)fail('unbalanced expression');
 const matches=[],functions=[];
 for(let at=0;at<tokens.length;at++){
  if(tokens[at].text==='match'){
   let open=at+1;
   for(;open<tokens.length;open++){
    if(tokens[open].text!=='{')continue;
    if(tokens[open+2]?.text==='}'||tokens[open+2]?.text==='='){open=pairs.get(open);continue;}
    break;
   }
   if(open===tokens.length)fail('unsupported match header');
   const header=tokens.slice(at,open+1).map(token=>token.text).join('');
   const captures=[];for(let key=at+1;key<open;key++)if(tokens[key].text==='{'){captures.push(tokens[key+1].text);key=pairs.get(key);}
   matches.push({header,captures,start:tokens[at].start,open:tokens[open].end,end:tokens[pairs.get(open)].end});
  }
  if(tokens[at].text==='function'){
   const paramOpen=at+2,paramEnd=pairs.get(paramOpen),bodyOpen=paramEnd+1,bodyEnd=pairs.get(bodyOpen);
   if(tokens[paramOpen]?.text!=='('||tokens[bodyOpen]?.text!=='{')fail('unsupported function declaration');
   const bindings=new Set(tokens.slice(paramOpen+1,paramEnd).filter(token=>token.type==='identifier').map(token=>token.text));
   for(let key=bodyOpen+1;key<bodyEnd;key++)if(tokens[key].text==='let')bindings.add(tokens[key+1].text);
   functions.push({name:tokens[at+1].text,start:tokens[at].start,end:tokens[bodyEnd].end,bindings});
  }
 }
 const databases=matches.filter(match=>match.header==='match/databases/{database}/documents{');
 if(databases.length!==1)fail('exactly one outer database document scope is required');
 return {source,tokens,pairs,matches,functions,database:databases[0]};
}
function assertDatabaseCapture(parsed,start,end){
 const outer=parsed.database;
 if(!(outer.open<=start&&end<outer.end))fail('a data path is outside the database scope');
 if(parsed.matches.some(match=>match!==outer&&match.open<=start&&end<match.end&&match.captures.includes('database')))fail('a nested match shadows database');
 if(parsed.functions.some(fn=>fn.start<start&&end<fn.end&&fn.bindings.has('database')))fail('a function binding shadows database');
}
function canonicalPaths(parsed){
 const {source,tokens,pairs}=parsed,nodes=[];
 for(let at=0;at<tokens.length;at++){
  if(!signature.every((text,offset)=>tokens[at+offset]?.text===text))continue;
  const start=tokens[at].start,prefixEnd=tokens[at+signature.length-1].end;
  if(source.slice(start,prefixEnd)!==canonicalPrefix)fail('ambiguous spacing or comments in a canonical path prefix');
  if(!operandBefore.has(tokens[at-1]?.text))fail('a canonical-looking prefix is not in a path-expression position');
  let cursor=at+signature.length,lastEnd=prefixEnd;const segments=[];
  while(tokens[cursor]?.text==='/'){
   if(tokens[cursor].start!==lastEnd)fail('ambiguous spacing before a path separator');
   const slash=tokens[cursor],first=tokens[cursor+1];if(!first||slash.end!==first.start)fail('ambiguous path segment');
   if(first.text==='$'&&tokens[cursor+2]?.text==='('){
    if(first.end!==tokens[cursor+2].start)fail('ambiguous interpolation');
    const open=cursor+2,close=pairs.get(open);if(close==null||close===open+1)fail('empty or unbalanced interpolation');
    segments.push({kind:'expression',start:tokens[open].end,end:tokens[close].start,text:source.slice(tokens[open].end,tokens[close].start)});
    lastEnd=tokens[close].end;cursor=close+1;
   }else{
    let end=cursor+1;
    while(end<tokens.length&&(end===cursor+1||tokens[end-1].end===tokens[end].start)&&(tokens[end].type==='identifier'||/^[0-9_-]$/.test(tokens[end].text)))end++;
    const text=source.slice(first.start,tokens[end-1]?.end);
    if(end===cursor+1||!/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(text))fail('unsupported static path segment');
    segments.push({kind:'literal',text});lastEnd=tokens[end-1].end;cursor=end;
   }
   if(tokens[cursor]?.text==='/')continue;
   if(tokens[cursor]&&!boundary.has(tokens[cursor].text))fail('unsupported suffix on a data path');
   break;
  }
  if(![2,4,6].includes(segments.length))fail('only complete document paths with two, four or six tail segments are supported');
  assertDatabaseCapture(parsed,start,lastEnd);
  nodes.push({start,end:lastEnd,segments,depth:segments.length});
 }
 // Paths may nest only inside an interpolation expression; crossing ranges
 // would make reconstruction or evaluation order ambiguous.
 for(const node of nodes)for(const other of nodes){if(node===other||other.start<=node.start||other.start>=node.end)continue;if(other.end>node.end||!node.segments.some(segment=>segment.kind==='expression'&&segment.start<=other.start&&other.end<=segment.end))fail('overlapping path literals');}
 return nodes;
}
function freshName(occupied,prefix){let name=prefix,suffix=0;while(occupied.has(name))name=prefix+(++suffix);occupied.add(name);return name;}
function eligiblePaths(parsed,nodes,excludedFunctions=[]){
 if(!Array.isArray(excludedFunctions)||excludedFunctions.some(name=>typeof name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))||new Set(excludedFunctions).size!==excludedFunctions.length)fail('excluded function names must be unique identifiers');
 const excluded=new Set(excludedFunctions);
 return nodes.filter(node=>!parsed.functions.some(fn=>excluded.has(fn.name)&&fn.start<node.start&&node.end<fn.end));
}
function topNodes(nodes,start,end){return nodes.filter(node=>start<=node.start&&node.end<=end&&!nodes.some(other=>other!==node&&start<=other.start&&other.start<=node.start&&node.end<=other.end&&other.end<=end));}
function replaceRanges(source,start,end,nodes,render){let out='',cursor=start;for(const node of topNodes(nodes,start,end).sort((a,b)=>a.start-b.start)){out+=source.slice(cursor,node.start)+render(node);cursor=node.end;}return out+source.slice(cursor,end);}
function selectorBlock(selectors){return '\n'+selectors.map(selector=>'    function '+selector.name+'('+selector.parameters.join(',')+') { return '+canonicalPrefix+selector.parameters.map(name=>'/$('+name+')').join('')+'; }').join('\n')+'\n';}
function selectorCalls(parsed,selectors){
 const byName=new Map(selectors.map(selector=>[selector.name,selector])),nodes=[],{tokens,pairs,source}=parsed;
 for(let at=0;at<tokens.length;at++){
  const selector=byName.get(tokens[at].text);if(!selector)continue;
  if(tokens[at-1]?.text==='function')fail('selector declarations must be removed before inverse parsing');
  if(tokens[at-1]?.text==='.'||tokens[at+1]?.text!=='(')fail('a selector name appears outside its unqualified call');
  const open=at+1,close=pairs.get(open);if(close==null)fail('unbalanced selector call');
  const args=[];let first=open+1;
  for(let cursor=first;cursor<close;cursor++){
   if(['(','[','{'].includes(tokens[cursor].text)){cursor=pairs.get(cursor);continue;}
   if(tokens[cursor].text===','){args.push({first,end:cursor-1});first=cursor+1;}
  }
  args.push({first,end:close-1});if(args.length!==selector.depth||args.some(arg=>arg.first>arg.end))fail('selector arity changed');
  const segments=args.map(arg=>{
   const firstToken=tokens[arg.first],lastToken=tokens[arg.end];
   if(arg.first===arg.end&&firstToken.type==='string'&&/^'[A-Za-z0-9_][A-Za-z0-9_-]*'$/.test(firstToken.text))return {kind:'literal',text:firstToken.text.slice(1,-1)};
   if(firstToken.text!=='('||pairs.get(arg.first)!==arg.end)fail('a dynamic selector argument lost its protective parentheses');
   return {kind:'expression',start:firstToken.end,end:lastToken.start,text:source.slice(firstToken.end,lastToken.start)};
  });
  const node={start:tokens[at].start,end:tokens[close].end,depth:selector.depth,segments};assertDatabaseCapture(parsed,node.start,node.end);nodes.push(node);
 }
 return nodes;
}
export function assertPathLoweringEquivalent(original,lowered,proof,options={}){
 if(!proof||proof.version!==1||proof.originalSha256!==hash(original)||proof.loweredSha256!==hash(lowered))fail('source hash proof differs');
 const old=layout(original),block=selectorBlock(proof.selectors),position=old.database.open;
 if(lowered.slice(position,position+block.length)!==block)fail('transparent selector bodies or placement changed');
 const body=lowered.slice(0,position)+lowered.slice(position+block.length),parsed=layout(body),nodes=selectorCalls(parsed,proof.selectors);
 const reconstruct=node=>canonicalPrefix+node.segments.map(segment=>segment.kind==='literal'?'/'+segment.text:'/$('+replaceRanges(body,segment.start,segment.end,nodes,reconstruct)+')').join('');
 const restored=replaceRanges(body,0,body.length,nodes,reconstruct);
 if(restored!==original)fail('independent path reconstruction changed another source byte');
 const allOriginalNodes=canonicalPaths(old),originalNodes=eligiblePaths(old,allOriginalNodes,proof.excludedFunctions||[]);
 if(proof.inlinePaths!==allOriginalNodes.length-originalNodes.length)fail('the inline path occurrence count changed');
 if(originalNodes.length!==nodes.length||proof.calls!==nodes.length)fail('the path occurrence count changed');
 const oldIdentifiers=new Set(old.tokens.filter(token=>token.type==='identifier').map(token=>token.text));
 const allocated=new Set();
 for(const selector of proof.selectors){
  if(![2,4,6].includes(selector.depth)||selector.parameters.length!==selector.depth)fail('selector depth changed');
  for(const name of [selector.name,...selector.parameters]){if(oldIdentifiers.has(name)||allocated.has(name)||!/^tkPath[A-Za-z0-9_]*$/.test(name))fail('a fresh selector binding collides');allocated.add(name);}
 }
 if(options.returnSource)return restored;
 return {pathsVerified:nodes.length,allOtherBytesExact:true,pinnedSelectorBodies:true,sameDatabaseBinding:true,originalSegmentEvaluationOrder:true};
}
export function lowerFirestorePaths(input,{excludedFunctions=[]}={}){
 if(typeof input!=='string'||Buffer.byteLength(input)>1024*1024)fail('use a bounded readable Rules source');
 // Shared read helpers already contain one reusable path expression. Keeping
 // that expression inline avoids an extra evaluated selector call per row in
 // large atomic batches, without changing any access predicate or row limit.
 const parsed=layout(input),allNodes=canonicalPaths(parsed),nodes=eligiblePaths(parsed,allNodes,excludedFunctions),occupied=new Set(parsed.tokens.filter(token=>token.type==='identifier').map(token=>token.text)),selectors=[];
 for(const depth of [...new Set(nodes.map(node=>node.depth))].sort((a,b)=>a-b))selectors.push({depth,name:freshName(occupied,'tkPath'+depth),parameters:Array.from({length:depth},(_,at)=>freshName(occupied,'tkPathSegment'+depth+'_'+at))});
 const byDepth=new Map(selectors.map(selector=>[selector.depth,selector]));
 const render=node=>byDepth.get(node.depth).name+'('+node.segments.map(segment=>segment.kind==='literal'?"'"+segment.text+"'":'('+replaceRanges(input,segment.start,segment.end,nodes,render)+')').join(',')+')';
 const body=replaceRanges(input,0,input.length,nodes,render),position=parsed.database.open,source=body.slice(0,position)+selectorBlock(selectors)+body.slice(position);
 const proof={version:1,originalSha256:hash(input),loweredSha256:hash(source),originalBytes:Buffer.byteLength(input),loweredBytes:Buffer.byteLength(source),calls:nodes.length,excludedFunctions:[...excludedFunctions],inlinePaths:allNodes.length-nodes.length,depths:Object.fromEntries(selectors.map(selector=>[selector.depth,nodes.filter(node=>node.depth===selector.depth).length])),selectors};
 return {source,proof:{...proof,...assertPathLoweringEquivalent(input,source,proof)}};
}
