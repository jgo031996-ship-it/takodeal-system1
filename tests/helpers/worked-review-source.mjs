import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isAbsolute,relative,sep} from 'node:path';

const root=new URL('../../',import.meta.url);
const proof=JSON.parse(readFileSync(new URL('../fixtures/worked-review-release.json',import.meta.url),'utf8'));
const inbox=JSON.parse(readFileSync(new URL('../fixtures/owner-inbox-release.json',import.meta.url),'utf8'));
const pathKey=name=>{const file=name instanceof URL?fileURLToPath(name):String(name);return (isAbsolute(file)?relative(fileURLToPath(root),file):file).split(sep).join('/');};
const hash=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const sync=JSON.parse(readFileSync(new URL('../fixtures/employee-live-sync.json',import.meta.url),'utf8'));
const onboarding=JSON.parse(readFileSync(new URL('../fixtures/staff-phone-onboarding.json',import.meta.url),'utf8'));
const stockReview=JSON.parse(readFileSync(new URL('../fixtures/branch-item-sync-review.json',import.meta.url),'utf8'));
const staffPin=JSON.parse(readFileSync(new URL('../fixtures/staff-pin-release.json',import.meta.url),'utf8'));
const originals=new Map();

// Historical checks can remove only a complete byte-identical release change.
// The current release scope test reads the working tree directly.
export function beforeWorkedReview(value,path){
 value=historicalBlob(value,staffPin.files[pathKey(path)]);
 value=historicalBlob(value,stockReview.files[pathKey(path)]);
 value=historicalBlob(value,onboarding.files[pathKey(path)]);
 value=historicalBlob(value,sync.files[pathKey(path)]);
 return historicalBlob(historicalBlob(value,inbox.files[pathKey(path)]),proof.files[pathKey(path)]);
}
function historicalBlob(value,row){
 if(!row?.before)return value;
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
  const bytes=readFileSync(new URL(file,root));
  const pinFile=staffPin.files[file],working=hash(bytes);
  if(pinFile&&pinFile.after!==working)return true;
  const repair=stockReview.files[file],candidate=pinFile?pinFile.before:working;
  if(repair&&repair.after!==candidate)return true;
  const onboardingFile=onboarding.files[file],digest=repair?repair.before:candidate;
  if(onboardingFile&&onboardingFile.after!==digest)return true;
  const live=sync.files[file],current=onboardingFile?onboardingFile.before:digest;
  if(live&&current!==live.after)return true;
  const revision=inbox.files[file],key=live?live.before:current;
  if(revision&&key!==revision.after)return true;
  const previous=revision?revision.before:key;
  const row=proof.files[file];
  if(!pinFile&&!repair&&!onboardingFile&&!live&&!revision&&(!row||previous!==row.after))return true;
  const original=row&&previous===row.after?row.before:previous;
  const listing=execFileSync('git',['ls-tree',base,'--',file],{cwd:root,encoding:'utf8'}).trim();
  return (listing.split(/\s+/)[2]||null)!==original;
 });
 const result=kept.join('\n')+(kept.length?'\n':'');return typeof output==='string'?result:Buffer.from(result);
}

