import {proof as personalProof} from './helpers/staff-personal-vault-inverse.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {restoreStaffAttendanceRecovery} from './helpers/staff-attendance-recovery-inverse.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),base='9dd4d1a211ee6fcc93f075d0bb238619ced6c9a1';
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
const previous=path=>git('show',base+':'+path),read=path=>restoreStaffAttendanceRecovery(readFileSync(new URL('../'+path,import.meta.url),'utf8'),path);
test('recovery inverse restores all original Staff business/attendance/authorization bytes before the final ready marker',()=>{
 const path='takodeal-staff/app.js',before=previous(path),after=read(path);
 assert.equal(after,before+'window.staffStartup?.ready();\n');
});
test('R2 page changes only exact inline placement and release labels from live39fc',()=>{
 const live='39fc7aa4a06132566ab20e10c80e5b093f23f0c0',path='takodeal-staff/index.html',before=git('show',live+':'+path),after=read(path);
 const block='    <!-- BEGIN GENERATED STAFF STARTUP -->\n    <script>'+read('takodeal-staff/staff-startup.js')+'</script>\n    <!-- END GENERATED STAFF STARTUP -->\n';
 assert.equal(after.split(block).length,2);const restored=after.replace(block,'').replaceAll('staff-startup-20261111-r2','staff-startup-20261111-r1').replace('    <script defer src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>','    <script defer src="staff-startup.js?v=staff-startup-20261111-r1"></script>\n    <script defer src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>');
 assert.equal(restored,before);assert.equal(read('takodeal-staff/app.js'),git('show',live+':takodeal-staff/app.js'));
 const runtimeProof=JSON.parse(read('tests/fixtures/staff-inline-runtime-inverse.json'));assert.equal(runtimeProof.base,live);assert.equal(runtimeProof.edits.length,4);let restoredRuntime=read(runtimeProof.file);for(const edit of [...runtimeProof.edits].reverse()){assert.equal(restoredRuntime.split(edit.after).length,2);restoredRuntime=restoredRuntime.replace(edit.after,()=>edit.before);}assert.equal(restoredRuntime,git('show',live+':takodeal-staff/staff-startup.js'));
 const stripGenerated=value=>value.replace(/\/\/ BEGIN GENERATED STAFF COHORT[\s\S]*?\/\/ END GENERATED STAFF COHORT/,'// PINNED COHORT');
 assert.equal(stripGenerated(read('takodeal-staff/sw.js')).replaceAll('staff-startup-20261111-r2','staff-startup-20261111-r1').replace('takodeal-staff-v55-inline-20261111-r2','takodeal-staff-v54-startup-20261111-r1'),stripGenerated(git('show',live+':takodeal-staff/sw.js')));
});
test('Cashier, other apps, shared runtime, Firebase functions, rules and dependencies cannot change in this Staff fix',()=>{
 const changed=[...git('diff','--name-only',base,'--').trim().split(/\r?\n/),...git('ls-files','--others','--exclude-standard').trim().split(/\r?\n/)].filter(Boolean);
 const allowed=new Set([...Object.keys(personalProof.files),...Object.keys(personalProof.newFiles),'takodeal-staff/live-branch-directory.js','takodeal-staff/staff-location.js','takodeal-staff/app.js','takodeal-staff/clock-upload-access.js','takodeal-staff/index.html','takodeal-staff/sw.js','takodeal-staff/staff-startup.js','takodeal-staff/staff-swap-request.js','takodeal-staff/staff-setup-access.js','takodeal-staff/staff-document-firebase.js','takodeal-staff/staff-self-repair.js','takodeal-staff/staff-self-repair-sdk.js']);
 for(const path of changed){
  if(path.startsWith('outputs/'))continue;
  if(/^(?:tests\/|tools\/build-staff-(?:shell-cohort|startup-inline)\.mjs$|\.github\/workflows\/staff-(?:startup|inline)-recovery-checks\.yml$|STAFF-STARTUP-RECOVERY\.md$)/.test(path))continue;
  if(['.github/workflows/hr-recovery-checks.yml','.github/workflows/dashboard-checks.yml','tools/prepare-prep-hosted-emulator.mjs','takodeal-staff/staff-access.js'].includes(path))continue;
  assert.ok(allowed.has(path),'Unexpected product change: '+path);
 }
});
