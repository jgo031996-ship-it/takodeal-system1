import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const pins={
  "takodeal-staff/staff-setup-access.js": "6f5a6f654f3bfa44295a18ec807f0c5b3a295f0323941b4c4cc08011c1fc93a0",
  "takodeal-staff/staff-registration.js": "5a5550aa8207404b7db6e20089c5e3ac2aadade5e1c94cc262537420e3c057dd",
  "takodeal-staff/clock-upload-access.js": "1c1ed79cfbc11593f996691b552e4f1c06d35043d7091b236d737bf8cf124ab3",
  "takodeal-staff/attendance-proof.js": "4dee95fb2f29d65d0d527f4db876d23d82ee8a6ea008104695f2fa41a5810f0d",
  "takodeal-staff/attendance-camera.js": "b00757339b6a38deb3b846d39eb0adc81eb84a41f88ffa65dfb49d27d8bffcc2",
  "takodeal-staff/private-phone-identity.js": "34fa90f1a7e7c6d8ed2e6da86950f1a17d533e3ae91af71313c774b7de2a79ca",
  "takodeal-staff/staff-loan-ledger-client.js": "cf14b790eb35eaa2e3a4061f3ae8637c858f939a1adcc9304f08e64a23b9c237",
  "takodeal-staff/staff-vault-recovery.js": "1953526fb2ab7fb7721fc5cf8a4d9f04344d2aec0d083a01b8f4b1141ab804dd",
  "functions/staff-device-setup/service.mjs": "2e6945441c3dbb4577a450660fe7634329500167a6e6cc102f0d40acfeb1ab7c",
  "docs/staff-document-storage.rules.snippet": "bb7fece03255d6184ea12057345fbab645546bd89acac4183ba28da23ea77ad8"
};
test('urgent phone activation, clock upload, private identity, existing loan/recovery and setup/Storage sources stay byte-exact LIVEa3',()=>{for(const [file,hash]of Object.entries(pins))assert.equal(sha(readFileSync(new URL('../'+file,import.meta.url))),hash,file);});
const functionPins={
  "checkNormalLogin": "97420eab3929084c67a149af1cfbea139e00b93dfc23336ade8ff9d77769f695",
  "loginStaff": "dbf61793caa0720d467f41ca33a49c4624a9029ab3530054b68e56a92197e2c9",
  "punchTime": "d9cde5a7c242ab35b25ef41f84dea1b87ec55aa60c252c95a638b42b9bd75d3b"
};
test('normal Staff restored/manual entry and complete Time In/Out handler stay byte-exact LIVEa3',()=>{const app=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8');for(const [name,hash]of Object.entries(functionPins)){const start=app.indexOf('window.'+name+' = '),end=app.indexOf('\n};',start);assert.ok(start>=0&&end>start,name);assert.equal(sha(app.slice(start,end+3)),hash,name);}});
