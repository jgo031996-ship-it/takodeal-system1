import {tokenizeRules} from '../firestore-rule-core.mjs';

// Excluding a function only leaves its original expressions inline. It cannot
// insert a statement, alter a predicate, or change the human policy source.
export function excludedFunctionNames(names=[]){
 if(!Array.isArray(names)||names.some(name=>typeof name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))||new Set(names).size!==names.length)throw Error('Selector scopes: excluded function names must be unique identifiers');
 return new Set(names);
}
export function selectOutsideFunctions(source,sites,names=[]){
 const excluded=excludedFunctionNames(names);
 if(!excluded.size)return sites;
 const tokens=tokenizeRules(source).filter(token=>!['comment','whitespace'].includes(token.type)),pairs=new Map(),stack=[],closing={')':'(',']':'[','}':'{'};
 for(let at=0;at<tokens.length;at++){
  const value=tokens[at].text;
  if(['(','[','{'].includes(value))stack.push(at);
  else if(closing[value]){const open=stack.pop();if(open==null||tokens[open].text!==closing[value])throw Error('Selector scopes: unbalanced source');pairs.set(open,at);}
 }
 if(stack.length)throw Error('Selector scopes: unbalanced source');
 const ranges=[];
 for(let at=0;at<tokens.length;at++)if(tokens[at].text==='function'&&excluded.has(tokens[at+1]?.text)){
  const parameterEnd=pairs.get(at+2),open=parameterEnd+1,end=pairs.get(open);
  if(tokens[at+2]?.text!=='('||tokens[open]?.text!=='{'||end==null)throw Error('Selector scopes: unsupported declaration');
  ranges.push({start:tokens[at].start,end:tokens[end].end});
 }
 return sites.filter(site=>!ranges.some(range=>range.start<site.start&&site.end<range.end));
}
