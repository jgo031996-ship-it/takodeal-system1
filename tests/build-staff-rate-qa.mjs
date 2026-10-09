import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),destination=path.resolve(root,'../staff-nextlevel-qa/rate');
const modules=['takodeal-staff/staff-portal.js','takodeal-staff/attendance-reconcile.js','takodeal-staff/staff-rate-privacy.js','takodeal-staff/staff-privacy.js','takodeal-manager/staff-rate-changes.js','takodeal-manager/hq-account-model.js','takodeal-manager/workspace-access-model.js'];
const manifest=[];for(const source of modules){const bytes=await readFile(path.join(root,source)),target='modules/'+source;await mkdir(path.dirname(path.join(destination,target)),{recursive:true});await writeFile(path.join(destination,target),bytes);manifest.push({source,target,sha256:createHash('sha256').update(bytes).digest('hex')});}
for(const name of ['index.html','app.mjs'])await writeFile(path.join(destination,name),await readFile(path.join(root,'tests/fixtures/staff-rate-qa',name)));
await writeFile(path.join(destination,'hashes.json'),JSON.stringify({generatedAt:new Date().toISOString(),modules:manifest},null,2)+'\n');console.log('Self-contained Staff rate verification: '+destination);
