import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),base='9dd4d1a211ee6fcc93f075d0bb238619ced6c9a1';
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
const previous=path=>git('show',base+':'+path),read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('all existing Staff business, attendance and authorization code is byte-exact before the final ready marker',()=>{
 const path='takodeal-staff/app.js',before=previous(path),after=read(path);
 assert.equal(after,before+'window.staffStartup?.ready();\n');
});
test('the page changes only release labels and independent recovery loading',()=>{
 const path='takodeal-staff/index.html',before=previous(path);
 const expected=before.replaceAll('staff-private-profile-20261110-r1','staff-startup-20261111-r1')
  .replace('    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>','    <script defer src="staff-startup.js?v=staff-startup-20261111-r1"></script>\n    <script defer src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>')
  .replace(/      <script type="module">\r?\n        import \{installStaffAppUpdate\} from "\.\/staff-phone\.js";\r?\n        installStaffAppUpdate\(\);\r?\n      <\/script>\r?\n/,'');
 assert.equal(read(path),expected);
});
test('Cashier, other apps, shared runtime, Firebase functions, rules and dependencies cannot change in this Staff fix',()=>{
 const changed=[...git('diff','--name-only',base,'--').trim().split(/\r?\n/),...git('ls-files','--others','--exclude-standard').trim().split(/\r?\n/)].filter(Boolean);
 const allowed=new Set(['takodeal-staff/app.js','takodeal-staff/index.html','takodeal-staff/sw.js','takodeal-staff/staff-startup.js']);
 for(const path of changed){
  if(/^(?:tests\/|tools\/build-staff-shell-cohort\.mjs$|\.github\/workflows\/staff-startup-recovery-checks\.yml$|STAFF-STARTUP-RECOVERY\.md$)/.test(path))continue;
  assert.ok(allowed.has(path),'Unexpected product change: '+path);
 }
});
