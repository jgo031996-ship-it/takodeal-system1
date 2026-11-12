import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {OWNER_DOCUMENT_RELEASE} from '../takodeal-manager/owner-update-notice.js';
import {restorePrivatePrepRelease} from './helpers/private-prep-release-inverse.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url));

test('phased Owner release preserves the live Rider and fleet implementation byte for byte',()=>{
 const pins={
  'takodeal-manager/main.js':'57224e4d7733c3e3710f305fa71d0a2d4c73b06a24fe89dee556c413b598ae7f',
  'takodeal-manager/owner-rider-access.js':'5dd629744e1c8e33a130efb5ea91c19413663f15560db8c81d7a8560d888268f',
  'takodeal-manager/device-fleet.js':'443db122a3f8c870f82625047a50bb08ba8e6194472e5ea7a9673471a6dc5296',
  'takodeal-manager/rider-management.js':'870b1d8c722d5764151c98cd2d5efd0089d3cf4c83b75e52272e11383ab8bd15',
  'takodeal-manager/rider-management-view.js':'f359f9d6d1acbe49d6ac40014c38e18f99bee5ed98a8773b00e5affbffae37bd',
  'takodeal-manager/rider-management.css':'8a597eb367c05670eadad01b92e6d2afd8c5da36061f92a90da825bb69a37ccb',
  'takodeal-manager/rider-delivery-safety.js':'51cc1a37ecad14eeebaab75ea63f8bf7d81be604ea55d2e62c41f1ce557aad1a',
  'functions/cash-remittance-review/rider-access-handler.mjs':'2151cdc5e53d819760be8936ac1b6cae6552dc01d907659cc2444dd80437cdf5',
  'functions/cash-remittance-review/rider-access-store.mjs':'d0a0180e3aa3d0a1c4ff0490391956838d7b357827ca1fe5ac988616b8cb062f',
  'functions/cash-remittance-review/rider-access-model.mjs':'87f93a7c8fa9036390c43a26c660c6b7fa004783b7d1c1c10f44e7d6cfe4c123'
 };
 for(const[path,hash]of Object.entries(pins))assert.equal(createHash('sha256').update(path==='takodeal-manager/main.js'?restorePrivatePrepRelease(path,read(path).toString()):read(path)).digest('hex'),hash,path+' remains pinned after removing only the exact reviewed private prep entry hooks');
 const wrapper=read('functions/cash-remittance-review/index.mjs').toString();assert.doesNotMatch(wrapper,/rider-command|createRiderCommand/);assert.match(wrapper,/request\.path\.startsWith\('\/rider-access\/'\)\?riderHandle/);
});

test('Owner-only release queries and cache identify the document and GCash cohort while Staff stays on its base release',()=>{
 assert.equal(OWNER_DOCUMENT_RELEASE,'takodeal-manager-core-v146-remote-staff-requests-20261112-r1');
 const worker=read('takodeal-manager/sw.js').toString(),html=read('takodeal-manager/index.html').toString();assert.ok(worker.includes(OWNER_DOCUMENT_RELEASE));assert.match(html,/<meta name="takodeal-release" content="remote-staff-requests-20261112-r1">/);assert.match(html,/auth\.js\?v=remote-staff-requests-20261112-r1/);assert.match(read('takodeal-manager/auth.js').toString(),/main\.js\?v=remote-staff-requests-20261112-r1/);
 for(const file of ['document-metadata-client.js','gcash-reconciliation-client.js'])assert.ok(worker.includes("'./"+file+"'"));
 assert.match(read('takodeal-staff/sw.js').toString(),/takodeal-staff-v50-security-loans-20261109/);assert.match(read('takodeal-staff/index.html').toString(),/app\.js\?v=staff-security-loans-20261109/);
});
