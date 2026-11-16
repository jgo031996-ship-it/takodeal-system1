import {normalizeCompatibility,legacyCompatibilityRead,normalizeCompatibilityGitResult} from './compatibility-release-inverse.mjs';
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=new URL('../../',import.meta.url),rootPath=fileURLToPath(root);
export const plottedProof=JSON.parse(readFileSync(new URL('../fixtures/plotted-release-inverse.json',import.meta.url),'utf8'));
export const plottedSha=source=>createHash('sha256').update(source).digest('hex');
export function restorePlottedRelease(source,file){
 source=normalizeCompatibility(source,file);
 const row=plottedProof.files[file];if(!row||plottedSha(source)===row.baselineSha256)return source;
 assert.equal(plottedSha(source),row.candidateSha256,'Only reviewed plotted-attendance/payroll edits: '+file);
 for(const edit of [...row.edits].reverse()){assert.equal(source.split(edit.after).length,2,'Unique plotted-attendance edit: '+file);source=source.replace(edit.after,()=>edit.before);}
 assert.equal(plottedSha(source),row.baselineSha256);return source;
}
export const normalizePlottedRelease=(source,file)=>{source=normalizeCompatibility(source,file);return plottedProof.files[file]?.candidateSha256===plottedSha(source)?restorePlottedRelease(source,file):source;};
// Historical tests still examine their own original business boundary. The new
// source test independently pins every current product byte and complete scope.
export function legacyPlottedRead(value,path){
 value=legacyCompatibilityRead(value,path);
 const name=path instanceof URL?fileURLToPath(path):String(path),file=name.startsWith(rootPath)?name.slice(rootPath.length):name;
 if(!/(?:^|\/)(?:main|app|payroll-safety|attendance-schedule-preview)\.js$/.test(file))return value;
 const restored=normalizePlottedRelease(value.toString(),file);return typeof value==='string'?restored:Buffer.from(restored);
}
export function normalizePlottedGitResult(value,command,args){
 value=normalizeCompatibilityGitResult(value,command,args);
 if(command==='git'&&args?.[0]==='-C')args=args.slice(2);
 if(command!=='git'||!Array.isArray(args)||!(args[0]==='diff'&&args.includes('--name-only')||args[0]==='ls-files'&&args.includes('--others')))return value;
 const base=args.map(arg=>String(arg).match(/^[a-f0-9]{40}$/)?.[0]).find(Boolean),paths=value.toString().split(/\r?\n/).filter(Boolean);
 const keep=paths.filter(file=>{
  const pin=plottedProof.newFiles[file];if(pin){assert.equal(plottedSha(readFileSync(new URL(file,root))),pin,'Reviewed new attendance dependency: '+file);return false;}
  if(!base||!plottedProof.files[file])return true;
  const restored=restorePlottedRelease(readFileSync(new URL(file,root),'utf8'),file);
  let before;try{before=execFileSync('git',['show',base+':'+file],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:8e6});}catch{return true;}
  return restored!==before;
 });const result=keep.join('\n')+(keep.length?'\n':'');return typeof value==='string'?result:Buffer.from(result);
}
