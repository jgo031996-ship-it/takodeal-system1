import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertDocumentReleaseCopies} from './helpers/owner-document-release-pins.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Staff and Owner retain reviewed metadata adapter cohorts and cache the imported dependency',()=>{
 assertDocumentReleaseCopies(['staff-document-store.js','document-metadata-client.js']);
 const owner=read('takodeal-manager/sw.js'),staff=read('takodeal-staff/sw.js');for(const worker of [owner,staff])assert.ok(worker.includes("'./document-metadata-client.js'"));assert.match(read('takodeal-staff/staff-document-store.js'),/import .*from '\.\/document-metadata-client\.js'/);
});
test('browser metadata writes move behind the fixed service while request-device transactions and all SDK reads remain',()=>{
 const source=read('takodeal-staff/staff-document-store.js'),upload=source.slice(source.indexOf('    async function upload('),source.indexOf('    async function file(')),review=source.slice(source.indexOf('    async function review('));
 for(const action of [upload,review])assert.doesNotMatch(action,/sdk\.runTransaction|tx\.(?:set|update|delete)/);assert.match(upload,/metadata\.upload\(/);assert.match(review,/metadata\.review\(/);assert.match(source.slice(source.indexOf('    async function requestDevice('),source.indexOf('    async function upload(')),/sdk\.runTransaction/);assert.match(source,/sdk\.getDocFromServer/);
});
