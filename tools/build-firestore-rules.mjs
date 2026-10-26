import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

export const GENERATED_RULES_HEADER='// Generated from firestore.policy.rules by tools/build-firestore-rules.mjs.\n// Edit the readable policy and rebuild. Only helper function names are shortened.\n';
const identifierStart=character=>/[A-Za-z_]/.test(character||'');
const identifierPart=character=>/[A-Za-z0-9_]/.test(character||'');
const builtinNames=new Set(['get','getAfter','exists','existsAfter','debug','path','string','int','float','bool','latlng','timestamp','duration','math','hashing','request','resource','service','match','allow','if','return','let','function','true','false','null','rules_version']);
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
function analyze(source){
 const tokens=tokenizeRules(source),code=codeTokens(tokens),definitions=new Map();
 for(let i=0;i<code.length;i++){
  if(code[i].type!=='identifier'||code[i].text!=='function'||code[i-1]?.text==='.')continue;
  const name=code[i+1];if(name?.type!=='identifier'||code[i+2]?.text!=='(')fail('an unsupported function declaration needs review.');
  if(builtinNames.has(name.text))fail('a helper shadows a built-in or reserved name: '+name.text+'.');
  if(definitions.has(name.text))fail('duplicate helper names need an explicit scope review: '+name.text+'.');
  definitions.set(name.text,name);
 }
 return{tokens,code,definitions};
}
const helperSite=(code,index)=>code[index-1]?.text==='function'||(code[index+1]?.text==='('&&code[index-1]?.text!=='.');
function mappingFor(analysis){
 const occupied=new Set(analysis.code.filter(token=>token.type==='identifier').map(token=>token.text)),mapping=new Map();let sequence=0;
 for(const name of analysis.definitions.keys()){let candidate;do{candidate='r'+(sequence++).toString(36);}while(occupied.has(candidate)||builtinNames.has(candidate));occupied.add(candidate);mapping.set(name,candidate);}
 return mapping;
}

// An independent inverse check permits changes only at actual declarations and
// unqualified calls. It also compares all trivia, strings, fields, operators and
// paths exactly; shortening names can never create a different permission rule.
export function assertRuleBuildEquivalent(policy,generated,mappingInput){
 const original=analyze(policy),mapping=mappingInput instanceof Map?mappingInput:new Map(mappingInput);
 if(mapping.size!==original.definitions.size||[...original.definitions.keys()].some(name=>!mapping.has(name)))fail('the helper mapping does not match the readable policy.');
 const oldNames=new Set(original.code.filter(token=>token.type==='identifier').map(token=>token.text)),shortNames=new Set();
 for(const short of mapping.values()){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(short)||oldNames.has(short)||shortNames.has(short)||builtinNames.has(short))fail('the generated helper name collides with the readable policy.');shortNames.add(short);}
 if(typeof generated!=='string'||!generated.startsWith(GENERATED_RULES_HEADER))fail('the generated header is missing or changed.');
 const body=generated.slice(GENERATED_RULES_HEADER.length),result=analyze(body),reverse=new Map([...mapping].map(([name,short])=>[short,name]));
 if(original.tokens.length!==result.tokens.length)fail('generation changed the token structure.');
 const sourceCodePosition=new Map(original.code.map((token,index)=>[token.start,index])),outputCodePosition=new Map(result.code.map((token,index)=>[token.start,index]));let replacements=0;
 const inverse=result.tokens.map((token,index)=>{
  const old=original.tokens[index],position=sourceCodePosition.get(old.start),site=old.type==='identifier'&&mapping.has(old.text)&&helperSite(original.code,position);
  const expected=site?mapping.get(old.text):old.text;
  if(token.type!==old.type||token.text!==expected)fail('generation altered a non-helper token or missed a helper reference.');
  if(site){replacements++;const outputPosition=outputCodePosition.get(token.start);if(!helperSite(result.code,outputPosition)||reverse.get(token.text)!==old.text)fail('inverse helper resolution changed a property or variable.');return reverse.get(token.text);}
  return token.text;
 }).join('');
 if(inverse!==policy)fail('inverse generation differs from the readable source.');
 if(result.definitions.size!==original.definitions.size||[...original.definitions.keys()].some(name=>!result.definitions.has(mapping.get(name))))fail('function declarations changed during generation.');
 return{tokensVerified:original.tokens.length,replacements,helpers:original.definitions.size};
}
export function buildFirestoreRules(policy){
 if(typeof policy!=='string'||policy.startsWith(GENERATED_RULES_HEADER))fail('use the readable policy, not a previously generated file.');
 const analysis=analyze(policy),mapping=mappingFor(analysis),replacementByStart=new Map();let callCount=0;
 for(let i=0;i<analysis.code.length;i++){const token=analysis.code[i];if(token.type==='identifier'&&mapping.has(token.text)&&helperSite(analysis.code,i)){replacementByStart.set(token.start,mapping.get(token.text));if(analysis.code[i-1]?.text!=='function')callCount++;}}
 const body=analysis.tokens.map(token=>replacementByStart.get(token.start)??token.text).join(''),source=GENERATED_RULES_HEADER+body;
 const proof=assertRuleBuildEquivalent(policy,source,mapping),sourceBytes=Buffer.byteLength(policy),generatedBytes=Buffer.byteLength(source);
 return{source,mapping:[...mapping],statistics:{helpers:proof.helpers,calls:callCount,replacements:proof.replacements,sourceBytes,generatedBytes,identifierBytesSaved:sourceBytes-Buffer.byteLength(body),tokensVerified:proof.tokensVerified}};
}
export function runRuleBuild({policyPath=fileURLToPath(new URL('../firestore.policy.rules',import.meta.url)),outputPath=fileURLToPath(new URL('../firestore.rules',import.meta.url)),check=false}={}){
 if(resolve(policyPath)===resolve(outputPath))fail('the readable policy and generated output must be separate files.');
 const policy=readFileSync(policyPath,'utf8'),result=buildFirestoreRules(policy);
 if(check){let saved;try{saved=readFileSync(outputPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;fail('generated Rules are missing. Run node tools/build-firestore-rules.mjs.');}if(saved!==result.source)fail('generated Rules are stale. Run node tools/build-firestore-rules.mjs.');}
 else writeFileSync(outputPath,result.source);
 return{...result.statistics,checked:check,policy:'firestore.policy.rules',generated:'firestore.rules'};
}
function main(args){
 let check=false,policyPath,outputPath;for(let i=0;i<args.length;i++){if(args[i]==='--check')check=true;else if(args[i]==='--policy'&&args[i+1])policyPath=args[++i];else if(args[i]==='--out'&&args[i+1])outputPath=args[++i];else fail('unsupported argument. Use --check, --policy <path> or --out <path>.');}
 console.log(JSON.stringify(runRuleBuild({policyPath,outputPath,check})));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}}
