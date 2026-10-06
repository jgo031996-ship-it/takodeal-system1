import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const destination=path.resolve(root,'../transaction-upgrades-qa/recipe');
const copies=['recipe-bulk.js','recipe-bulk-model.js','recipe-changes.js','recipe-integrity.js','workspace-access-model.js','hq-account-model.js'];
const manifest=[];
await mkdir(path.join(destination,'modules/takodeal-manager'),{recursive:true});
for(const name of copies){const source='takodeal-manager/'+name,data=await readFile(path.join(root,source)),target='modules/'+source;await writeFile(path.join(destination,target),data);manifest.push({source,target,sha256:createHash('sha256').update(data).digest('hex')});}
for(const name of ['index.html','app.mjs','fake-store.mjs'])await writeFile(path.join(destination,name),await readFile(path.join(root,'tests/fixtures/recipe-qa',name)));
await writeFile(path.join(destination,'hashes.json'),JSON.stringify({generatedAt:new Date().toISOString(),modules:manifest},null,2)+'\n');
console.log('Self-contained recipe verification created at '+destination+'. All browser dependencies remain within the QA folder.');
