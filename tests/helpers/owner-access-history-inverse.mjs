import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=new URL('../../',import.meta.url),rootPath=fileURLToPath(root);
export const ownerAccessProof=JSON.parse(readFileSync(new URL('../fixtures/owner-access-history-inverse.json',import.meta.url),'utf8'));
export const ownerAccessSha=source=>createHash('sha256').update(source).digest('hex');
export function restoreOwnerAccess(source,file){
 const row=ownerAccessProof.files[file];if(!row||ownerAccessSha(source)===row.baselineSha256)return source;
 assert.equal(ownerAccessSha(source),row.candidateSha256,'Only reviewed Owner access/history edits: '+file);
 for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(ownerAccessSha(source),row.baselineSha256);return source;
}
export const normalizeOwnerAccess=(source,file)=>ownerAccessProof.files[file]?.candidateSha256===ownerAccessSha(source)?restoreOwnerAccess(source,file):source;
export function legacyOwnerAccessRead(value,path){
 const name=path instanceof URL?fileURLToPath(path):String(path),file=name.startsWith(rootPath)?name.slice(rootPath.length):name;
 const restored=normalizeOwnerAccess(value.toString(),file);return typeof value==='string'?restored:Buffer.from(restored);
}
export function normalizeOwnerAccessGitResult(value,command,args){
 if(command==='git'&&args?.[0]==='-C')args=args.slice(2);
 if(command!=='git'||!Array.isArray(args)||args[0]!=='diff'||!args.includes('--name-only'))return value;
 const base=args.find(arg=>/^[a-f0-9]{40}$/.test(arg));if(!base)return value;
 const keep=value.toString().split(/\r?\n/).filter(Boolean).filter(file=>{
  if(!ownerAccessProof.files[file])return true;
  const restored=restoreOwnerAccess(readFileSync(new URL(file,root),'utf8'),file);
  let old;try{old=execFileSync('git',['show',base+':'+file],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:8e6});}catch{return true;}
  return restored!==old;
 });const result=keep.join('\n')+(keep.length?'\n':'');return typeof value==='string'?result:Buffer.from(result);
}
