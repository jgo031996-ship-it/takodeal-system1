import {cp,mkdir,readdir,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(root,'dist');
if(out!==resolve(root,'dist'))throw Error('Invalid build output');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
for(const entry of await readdir(root,{withFileTypes:true})){
  if(entry.name.startsWith('.')||['api','server','scripts','dist','node_modules','package.json','package-lock.json','vercel.json'].includes(entry.name)||entry.name.endsWith('.md'))continue;
  await cp(resolve(root,entry.name),resolve(out,entry.name),{recursive:true});
}
console.log('Owner App static assets built; server source excluded from public output.');
