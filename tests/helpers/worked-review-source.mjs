import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isAbsolute,relative,sep} from 'node:path';

const root=new URL('../../',import.meta.url);
const proof=JSON.parse(readFileSync(new URL('../fixtures/worked-review-release.json',import.meta.url),'utf8'));
const pathKey=name=>{const file=name instanceof URL?fileURLToPath(name):String(name);return (isAbsolute(file)?relative(fileURLToPath(root),file):file).split(sep).join('/');};
const hash=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const originals=new Map();

// Historical checks can remove only a complete byte-identical release change.
// The current release scope test reads the working tree directly.
export function beforeWorkedReview(value,path){
 const row=proof.files[pathKey(path)];
 if(!row)return value;
 const bytes=Buffer.from(value);
 if(hash(bytes)!==row.after)return value;
 if(!originals.has(row.before)){
  const previous=execFileSync('git',['cat-file','blob',row.before],{cwd:root,maxBuffer:8e6});
  if(hash(previous)!==row.before)throw Error('Previous release blob does not match its recorded identity.');
  originals.set(row.before,previous);
 }
 const previous=originals.get(row.before);
 return typeof value==='string'?previous.toString():Buffer.from(previous);
}
export function beforeWorkedReviewPaths(output,command,args){
 if(command!=='git'||!Array.isArray(args))return output;
 if(args[0]==='-C')args=args.slice(2);
 if(args[0]!=='diff'||!args.includes('--name-only'))return output;
 const base=args.find(arg=>/^[a-f0-9]{40}$/.test(arg));
 if(!base)return output;
 const kept=output.toString().split(/\r?\n/).filter(Boolean).filter(file=>{
  const row=proof.files[file];if(!row)return true;
  if(hash(readFileSync(new URL(file,root)))!==row.after)return true;
  try{return execFileSync('git',['rev-parse','--verify',base+':'+file],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()!==row.before;}
  catch{return true;}
 });
 const result=kept.join('\n')+(kept.length?'\n':'');return typeof output==='string'?result:Buffer.from(result);
}

