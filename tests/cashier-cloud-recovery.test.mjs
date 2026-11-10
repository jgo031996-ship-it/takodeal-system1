import {restoreCashierVoidIntegration} from './helpers/cashier-void-inverse.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {restoreCashierCloudTransport} from './helpers/cashier-cloud-transport-inverse.mjs';
import {CASHIER_RELEASE} from '../Takodeal-POS/cashier-data.js';
const read=file=>{const source=readFileSync(new URL('../Takodeal-POS/'+file,import.meta.url),'utf8');return file==='main.js'?source:restoreCashierVoidIntegration(source,'Takodeal-POS/'+file);},sha=value=>createHash('sha256').update(value).digest('hex');
const release='cashier-cloud-recovery-20261110-r1';
test('primary SDK transport explicitly forces long polling while retaining the exact persistent multi-tab cache manager',()=>{
 const source=read('main.js'),start=source.indexOf('const db = initializeFirestore(app, {'),end=source.indexOf('\n});',start)+4;assert.ok(start>=0&&end>start);const app={},manager={},cache={},database={};let options,cacheOptions,managerCalls=0;
 const context={app,initializeFirestore:(input,settings)=>{assert.equal(input,app);options=settings;return database;},persistentLocalCache:settings=>{cacheOptions=settings;return cache;},persistentMultipleTabManager:()=>{managerCalls++;return manager;}};
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.selectedDb=db;',context);assert.equal(context.selectedDb,database);assert.equal(options.experimentalForceLongPolling,true);assert.equal(options.experimentalAutoDetectLongPolling,false);assert.equal(options.localCache,cache);assert.deepEqual(Object.keys(options).sort(),['experimentalAutoDetectLongPolling','experimentalForceLongPolling','localCache']);assert.deepEqual(Object.keys(cacheOptions),['tabManager']);assert.equal(cacheOptions.tabManager,manager);assert.equal(managerCalls,1);
});
test('after the exact void integration inverse, reversing the two transport options restores EVERY main byte to exact live54a including login, Time Clock, checkout, finance and prep',()=>{
 assert.equal(sha(restoreCashierCloudTransport(read('main.js'))),'a6483411ca996319dd094a44c1b1fff08fc625bf7ba17fe5463307263f4aa8fe');
});
test('the dedicated patch changes only the shell release keys and never the photo cache or any saved-data identity',()=>{
 assert.equal(CASHIER_RELEASE,'cashier-void-original-20261111-r2');assert.equal(sha(read('cashier-data.js').replace(release,'update-progress-20261108-r1')),'fd86acf0cdbaf44e832a3a7b5d2ed218c5813446ddf6bede6289fcf9ea373517');
 for(const [file,hash]of [['index.html','a8d89aec4dd2a9a405ab0cdd83ef34146ac735dacecc88d58c1d81160516f7b6'],['sw.js','ec0426bfcb27b9a12e7aed302466e18ee0826d83577e24fce70e603e0a548bf5']]){const source=read(file);assert.equal(source.split(release).length,2);assert.equal(sha(source.replace(release,'cashier-connection-recovery-20261110-r1')),hash);}
 assert.match(read('sw.js'),/const PHOTOS = 'takodeal-pos-photos-offline02'/);assert.doesNotMatch(read('sw.js'),/indexedDB\.deleteDatabase|localStorage\.clear/);assert.equal(existsSync(new URL('../Takodeal-POS/offline-pos-login.js',import.meta.url)),false);
});
