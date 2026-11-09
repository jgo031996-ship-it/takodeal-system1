import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=readFileSync(new URL('../docs/staff-document-storage.rules.snippet',import.meta.url),'utf8');
test('activated evidence extends exact activea17 Storage only; all other app/private upload policy bytes remain exact',()=>{
 const start=source.indexOf('    // Personal-code activation authorizes operational evidence only.'),end=source.indexOf('    function ownRider(',start);assert.ok(start>=0&&end>start);let restored=source.slice(0,start)+source.slice(end);
 const beforeRead='allow read: if owner() || ownStaff(uid,staffId) || ownClock(uid,staffId);',afterRead="allow read: if owner() || (file.matches('^activated_.*$') ? ownActivatedAttendance(uid,staffId,file,false) : ownStaff(uid,staffId) || ownClock(uid,staffId));";
 const beforeCreate='&& (owner() || ownStaff(uid,staffId) || ownClock(uid,staffId));',afterCreate="&& (file.matches('^activated_.*$') ? ownActivatedAttendance(uid,staffId,file,true) : owner() || ownStaff(uid,staffId) || ownClock(uid,staffId));";
 assert.equal(restored.split(afterRead).length-1,1);assert.equal(restored.split(afterCreate).length-1,1);restored=restored.replace(afterRead,beforeRead).replace(afterCreate,beforeCreate);assert.equal(createHash('sha256').update(restored).digest('hex'),'a17d8fc3f04502918130efe9bd49ad8349851c38ffa6849e70219a0a3c9e10d5');
 const helper=source.slice(start,end);assert.equal((helper.match(/firestore\.get\(/g)||[]).length,2);assert.match(helper,/staff_app_bindings/);assert.match(helper,/cashiers/);assert.doesNotMatch(helper,/staff_document_devices|staff_private_documents|staff_login_sessions|staff_pin_contexts/);
 const staffFiles=source.slice(source.indexOf('    match /staff_requests/'),source.indexOf('    match /staff_profiles/'));assert.match(staffFiles,/\? ownActivatedAttendance/);assert.doesNotMatch(staffFiles,/ownStaff\(uid,staffId\) \|\| ownActivatedAttendance/);
});
test('Staff release caches the full changed dependency graph and retains network-first updates without credential resets',()=>{
 const worker=readFileSync(new URL('../takodeal-staff/sw.js',import.meta.url),'utf8'),html=readFileSync(new URL('../takodeal-staff/index.html',import.meta.url),'utf8');assert.match(worker,/v52-doc-metadata-20261109-r1/);assert.match(html,/app\.js\?v=staff-doc-metadata-20261109-r1/);
 for(const file of ['app.js','attendance-proof.js','clock-upload-access.js','staff-access.js','staff-setup-access.js','staff-phone.js','app-update.js','private-phone-identity.js','document-metadata-client.js'])assert.ok(worker.includes("'./"+file+"'"));assert.match(worker,/await fetch\(event\.request\)/);assert.doesNotMatch(worker,/localStorage\.clear|indexedDB\.deleteDatabase/);
});
