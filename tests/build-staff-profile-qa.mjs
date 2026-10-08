import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const outputs=[path.resolve(root,'../staff-nextlevel-qa/profile'),path.resolve(root,'../transaction-upgrades-qa/staff-nextlevel/profile')];
const originals=['takodeal-staff/staff-portal.js','takodeal-staff/attendance-reconcile.js','takodeal-staff/staff-privacy.js','takodeal-staff/staff-rate-privacy.js','takodeal-staff/staff-documents.js','takodeal-staff/staff-document-store.js','takodeal-staff/staff-document-model.js','takodeal-staff/staff-documents.css','takodeal-manager/staff-document-hq.js','takodeal-manager/staff-documents.js','takodeal-manager/staff-document-store.js','takodeal-manager/staff-document-model.js','takodeal-manager/staff-rate-changes.js','takodeal-manager/hq-account-model.js','takodeal-manager/workspace-access-model.js'];
for(const output of outputs){
  await fs.mkdir(output,{recursive:true});const hashes={generatedAt:new Date().toISOString(),sourceRoot:root,actualModules:{},mockedAdapters:['takodeal-manager/staff-document-firebase.js'],note:'Actual production document cards, store and UI installers plus actual rate/PIN modules. Firebase adapter is replaced by a local-only throwing stub; createVault injects the isolated sample SDK. No network or live writes.'};
  for(const file of originals){const bytes=await fs.readFile(path.join(root,file));const target=path.join(output,'modules',file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);hashes.actualModules[file]=crypto.createHash('sha256').update(bytes).digest('hex');}
  for(const file of ['index.html','fixture.css','app.mjs','sw.js'])await fs.copyFile(path.join(root,'tests/fixtures/staff-profile-qa',file),path.join(output,file));
  await fs.copyFile(path.join(root,'tests/fixtures/staff-profile-qa/firebase-stub.js'),path.join(output,'modules/takodeal-manager/staff-document-firebase.js'));
  await fs.writeFile(path.join(output,'hashes.json'),JSON.stringify(hashes,null,2)+'\n');console.log(output);
}
