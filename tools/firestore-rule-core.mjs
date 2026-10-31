export const GENERATED_RULES_HEADER='// Generated from firestore.policy.rules by tools/build-firestore-rules.mjs.\n// Edit the readable policy and rebuild. Proved selector sharing and scoped name shortening preserve its authorization predicates.\n';
const identifierStart=character=>/[A-Za-z_]/.test(character||'');
const identifierPart=character=>/[A-Za-z0-9_]/.test(character||'');
const builtinNames=new Set(['get','getAfter','exists','existsAfter','debug','path','string','int','float','bool','latlng','timestamp','duration','math','hashing','request','resource','service','match','allow','if','return','let','function','true','false','null','rules_version','is','in','map','list','set','number','constraint','database','cloud','firestore']);
const fail=message=>{throw Error('Rules build: '+message);};

// Retain every source byte in a token. Strings and comments are opaque; a regex
// replacement must never rewrite record keys, document paths or quoted values.
export function tokenizeRules(source){
 if(typeof source!=='string')fail('policy source must be text.');
 const tokens=[];let offset=0;
 while(offset<source.length){
  const start=offset,character=source[offset],next=source[offset+1];let type;
  if(/\s/.test(character)){type='whitespace';while(offset<source.length&&/\s/.test(source[offset]))offset++;}
  else if(character==='/'&&next==='/'){type='comment';offset+=2;while(offset<source.length&&source[offset]!=='\n')offset++;}
  else if(character==='/'&&next==='*'){type='comment';const end=source.indexOf('*/',offset+2);if(end<0)fail('unterminated block comment.');offset=end+2;}
  else if(character==='"'||character==="'"){
   type='string';const quote=character;offset++;let closed=false;
   while(offset<source.length){if(source[offset]==='\\'){if(offset+1>=source.length)fail('unterminated quoted string.');offset+=2;}else if(source[offset++]===quote){closed=true;break;}}
   if(!closed)fail('unterminated quoted string.');
  }else if(identifierStart(character)){type='identifier';offset++;while(offset<source.length&&identifierPart(source[offset]))offset++;}
  else{type='punctuation';offset++;}
  tokens.push({type,text:source.slice(start,offset),start,end:offset});
 }
 return tokens;
}
const codeTokens=tokens=>tokens.filter(token=>!['whitespace','comment'].includes(token.type));
function pairsFor(code){
 const pairs=new Map(),stack=[],closing={')':'(',']':'[','}':'{'};
 for(let i=0;i<code.length;i++){
  const text=code[i].text;if(['(','[','{'].includes(text))stack.push(i);
  else if(closing[text]){const open=stack.pop();if(open==null||code[open].text!==closing[text])fail('unbalanced declaration or expression.');pairs.set(open,i);}
 }
 if(stack.length)fail('unbalanced declaration or expression.');return pairs;
}
// Only simple Rules functions are accepted: identifier parameters, zero or more
// function-level let statements, then one return. Nested functions and duplicate
// bindings are rejected rather than assigned an inferred lexical meaning.
function functionScope(code,pairs,index,ordinal){
 const parameterOpen=index+2,parameterEnd=pairs.get(parameterOpen),bodyOpen=parameterEnd+1,bodyEnd=pairs.get(bodyOpen),bindings=new Map();
 if(parameterEnd==null||code[bodyOpen]?.text!=='{'||bodyEnd==null)fail('an unsupported function body needs review.');
 const add=(at,activeFrom,kind)=>{const name=code[at];if(name?.type!=='identifier'||bindings.has(name.text))fail('duplicate or unsupported function bindings need review.');bindings.set(name.text,{name:name.text,declaration:at,activeFrom,kind,key:ordinal+':'+bindings.size});};
 let cursor=parameterOpen+1;
 while(cursor<parameterEnd){add(cursor,bodyOpen+1,'parameter');cursor++;if(cursor===parameterEnd)break;if(code[cursor++]?.text!==','||cursor===parameterEnd)fail('an unsupported parameter list needs review.');}
 cursor=bodyOpen+1;
 const statementEnd=start=>{for(let at=start;at<bodyEnd;at++){if(code[at].text==='function')fail('nested functions are not supported.');if(['(','[','{'].includes(code[at].text)){const end=pairs.get(at);if(end==null||end>=bodyEnd)fail('an unsupported statement needs review.');at=end;}else if(code[at].text===';')return at;}fail('an unterminated function statement needs review.');};
 while(code[cursor]?.text==='let'){
  const declaration=cursor+1;if(code[declaration+1]?.text!=='=')fail('an unsupported let declaration needs review.');const end=statementEnd(declaration+2);add(declaration,end+1,'let');cursor=end+1;
 }
 if(code[cursor]?.text!=='return')fail('a function without one final return needs review.');
 const end=statementEnd(cursor+1);if(end!==bodyEnd-1)fail('unsupported statements after a return need review.');
 for(let at=bodyOpen+1;at<bodyEnd;at++)if(code[at].text==='function'&&code[at-1]?.text!=='.')fail('nested functions are not supported.');
 return{ordinal,bodyOpen,bodyEnd,bindings};
}
// Literal path segments are not variables. The expressions inside $(...) are
// ordinary expression scopes. A slash following an operand is division.
function literalPathSites(code,pairs,start,end){
 const sites=new Set(),operandBefore=new Set(['(','[','=',',',':','?','!','&','|','+','-','*','/','%','<','>','return']);
 for(let i=start;i<end;i++){
  if(code[i].text!=='/'||!operandBefore.has(code[i-1]?.text))continue;
  let at=i;
  while(code[at]?.text==='/'&&at<end){
   const segment=code[at+1],staticPart=token=>token&&(token.type==='identifier'||/^[0-9_.-]$/.test(token.text));
   if(staticPart(segment)){
    // A literal segment such as owner-id-2026 is one static path component,
    // even though the lexer exposes its hyphens and digits separately.
    let part=at+1;while(part<end&&staticPart(code[part])&&(part===at+1||code[part-1].end===code[part].start)){if(code[part].type==='identifier')sites.add(part);part++;}at=part;
   }
   else if(segment?.text==='$'&&code[at+2]?.text==='('){const close=pairs.get(at+2);if(close==null||close>=end)fail('an unsupported path interpolation needs review.');for(const nested of literalPathSites(code,pairs,at+3,close))sites.add(nested);at=close+1;}
   else fail('an unsupported literal path segment needs review.');
   // Never resume ordinary variable resolution halfway through an unfamiliar
   // path segment (for example prefix$(id) or $(id)-suffix).
   if(code[at]&&code[at-1].end===code[at].start&&code[at].text!=='/'&&![')',']','}',',',';','?','=',':','!','&','|','+','*','%','<','>'].includes(code[at].text))fail('an unsupported literal path boundary needs review.');
  }
  i=at-1;
 }
 return sites;
}
function bindingSites(code,pairs,scope){
 const sites=new Map(),literal=literalPathSites(code,pairs,scope.bodyOpen+1,scope.bodyEnd),stack=[];
 for(const binding of scope.bindings.values())sites.set(binding.declaration,binding);
 for(let i=scope.bodyOpen+1;i<scope.bodyEnd;i++){
  const token=code[i],text=token.text,previous=code[i-1]?.text;
  const mapKey=token.type==='identifier'&&code[i+1]?.text===':'&&stack.at(-1)?.text==='{'&&['{',','].includes(previous);
  if(token.type==='identifier'&&scope.bindings.has(text)&&!sites.has(i)&&previous!=='.'&&previous!=='is'&&!mapKey&&!literal.has(i)){
   const binding=scope.bindings.get(text);
   if(i>=binding.activeFrom)sites.set(i,binding);
   // This narrow build deliberately refuses an initializer or earlier free
   // reference with the same name as a later local. Its meaning stays readable.
   else fail('a self or forward reference needs an explicit scope review: '+text+'.');
  }
  if(['(','[','{'].includes(text))stack.push({text,index:i});else if([')',']','}'].includes(text))stack.pop();
 }
 return sites;
}
function analyze(source){
 const tokens=tokenizeRules(source),code=codeTokens(tokens),definitions=new Map(),scopes=[],pairs=pairsFor(code);
 for(let i=0;i<code.length;i++){
  if(code[i].type!=='identifier'||code[i].text!=='function'||code[i-1]?.text==='.')continue;
  const name=code[i+1];if(name?.type!=='identifier'||code[i+2]?.text!=='(')fail('an unsupported function declaration needs review.');
  if(builtinNames.has(name.text))fail('a helper shadows a built-in or reserved name: '+name.text+'.');
  if(definitions.has(name.text))fail('duplicate helper names need an explicit scope review: '+name.text+'.');
  definitions.set(name.text,name);
  scopes.push(functionScope(code,pairs,i,scopes.length));
 }
 const boundSites=new Map();for(const scope of scopes){for(const name of scope.bindings.keys())if(definitions.has(name))fail('a local binding shadows a helper: '+name+'.');for(const [at,binding] of bindingSites(code,pairs,scope))boundSites.set(at,binding);}
 return{tokens,code,definitions,scopes,boundSites};
}
const helperSite=(code,index)=>code[index-1]?.text==='function'||(code[index+1]?.text==='('&&code[index-1]?.text!=='.');
function mappingFor(analysis){
 const occupied=new Set(analysis.code.filter(token=>token.type==='identifier').map(token=>token.text)),mapping=new Map();let sequence=0;
 for(const name of analysis.definitions.keys()){let candidate;do{candidate='r'+(sequence++).toString(36);}while(occupied.has(candidate)||builtinNames.has(candidate));occupied.add(candidate);mapping.set(name,candidate);}
 return mapping;
}
function localsFor(analysis,helperMapping){
 const occupied=new Set([...analysis.code.filter(token=>token.type==='identifier').map(token=>token.text),...builtinNames,...helperMapping.values()]),mapping=new Map(),alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_';
 for(const scope of analysis.scopes){let sequence=0;for(const binding of scope.bindings.values()){while(sequence<alphabet.length&&occupied.has(alphabet[sequence]))sequence++;if(sequence===alphabet.length)fail('there are too few fresh single-character aliases for this function.');mapping.set(binding.key,alphabet[sequence++]);}}
 return mapping;
}

// An independent inverse check permits changes only at actual declarations and
// unqualified calls. It also compares all trivia, strings, fields, operators and
// paths exactly; shortening names can never create a different permission rule.
export function assertRuleAlphaEquivalent(policy,generated,mappingInput,options={}){
 const original=analyze(policy),mapping=mappingInput instanceof Map?mappingInput:new Map(mappingInput);
 if(mapping.size!==original.definitions.size||[...original.definitions.keys()].some(name=>!mapping.has(name)))fail('the helper mapping does not match the readable policy.');
 const oldNames=new Set(original.code.filter(token=>token.type==='identifier').map(token=>token.text)),shortNames=new Set();
 for(const short of mapping.values()){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(short)||oldNames.has(short)||shortNames.has(short)||builtinNames.has(short))fail('the generated helper name collides with the readable policy.');shortNames.add(short);}
 if(typeof generated!=='string'||!generated.startsWith(GENERATED_RULES_HEADER))fail('the generated header is missing or changed.');
 const body=generated.slice(GENERATED_RULES_HEADER.length),result=analyze(body),reverse=new Map([...mapping].map(([name,short])=>[short,name])),locals=localsFor(original,mapping);
 if(original.tokens.length!==result.tokens.length)fail('generation changed the token structure.');
 const sourceCodePosition=new Map(original.code.map((token,index)=>[token.start,index])),outputCodePosition=new Map(result.code.map((token,index)=>[token.start,index]));let replacements=0;
 let localReplacements=0;
 const inverse=result.tokens.map((token,index)=>{
  const old=original.tokens[index],position=sourceCodePosition.get(old.start),site=old.type==='identifier'&&mapping.has(old.text)&&helperSite(original.code,position),binding=original.boundSites.get(position),outputPosition=outputCodePosition.get(token.start),outputBinding=result.boundSites.get(outputPosition);
  const expected=binding?locals.get(binding.key):site?mapping.get(old.text):old.text;
  if(token.type!==old.type||token.text!==expected)fail('generation altered a non-binding token or missed a scoped reference.');
  // Both texts are parsed independently. Every renamed local must resolve to
  // the same function/declaration edge; preserved free tokens cannot be captured.
  if((binding?.key??null)!==(outputBinding?.key??null))fail('inverse binding resolution changed lexical capture.');
  if(binding){localReplacements++;return old.text;}
  if(site){replacements++;const outputPosition=outputCodePosition.get(token.start);if(!helperSite(result.code,outputPosition)||reverse.get(token.text)!==old.text)fail('inverse helper resolution changed a property or variable.');return reverse.get(token.text);}
  return token.text;
 }).join('');
 if(inverse!==policy)fail('inverse generation differs from the readable source.');
 if(result.definitions.size!==original.definitions.size||[...original.definitions.keys()].some(name=>!result.definitions.has(mapping.get(name))))fail('function declarations changed during generation.');
 if(options.returnSource)return inverse;
 return{tokensVerified:original.tokens.length,replacements,helpers:original.definitions.size,localReplacements,bindings:locals.size};
}
export function buildFirestoreRulesAlpha(policy){
 if(typeof policy!=='string'||policy.startsWith(GENERATED_RULES_HEADER))fail('use the readable policy, not a previously generated file.');
 const analysis=analyze(policy),mapping=mappingFor(analysis),locals=localsFor(analysis,mapping),replacementByStart=new Map();let callCount=0;
 for(let i=0;i<analysis.code.length;i++){const token=analysis.code[i];if(token.type==='identifier'&&mapping.has(token.text)&&helperSite(analysis.code,i)){replacementByStart.set(token.start,mapping.get(token.text));if(analysis.code[i-1]?.text!=='function')callCount++;}}
 for(const [at,binding] of analysis.boundSites)replacementByStart.set(analysis.code[at].start,locals.get(binding.key));
 const body=analysis.tokens.map(token=>replacementByStart.get(token.start)??token.text).join(''),source=GENERATED_RULES_HEADER+body;
 const proof=assertRuleAlphaEquivalent(policy,source,mapping),sourceBytes=Buffer.byteLength(policy),generatedBytes=Buffer.byteLength(source);
 return{source,mapping:[...mapping],statistics:{helpers:proof.helpers,calls:callCount,replacements:proof.replacements,bindings:proof.bindings,localReplacements:proof.localReplacements,sourceBytes,generatedBytes,identifierBytesSaved:sourceBytes-Buffer.byteLength(body),tokensVerified:proof.tokensVerified}};
}
