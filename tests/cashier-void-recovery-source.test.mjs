import {restoreLiveBranchDirectory} from './helpers/live-branch-directory-inverse.mjs';
// Apply only the separately hash-verified public discovery patch before these
// historical business/transport byte comparisons. The new source test pins it.
const readFileSync=(path,...args)=>{const value=originalReadFileSync(path,...args),name=path instanceof URL?path.pathname:String(path);if(!name.endsWith('/Takodeal-POS/main.js'))return value;const restored=restoreLiveBranchDirectory(value.toString(),'Takodeal-POS/main.js');return typeof value==='string'?restored:Buffer.from(restored);};
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync as originalReadFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {restoreCashierVoidRecovery} from './helpers/cashier-void-recovery-inverse.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),sha=s=>createHash('sha256').update(s).digest('hex');
test('seven exact scoped inverses restore every pre-existing product byte to live d107, with two pinned new modules',()=>{
 const proof=JSON.parse(read('tests/fixtures/cashier-void-recovery-inverse.json'));assert.equal(proof.base,'d1079e2e1274c99323ce918333bef50dbaf83667');assert.equal(Object.keys(proof.files).length,7);assert.equal(Object.keys(proof.newFiles).length,2);
 for(const [file,pin]of Object.entries(proof.files)){assert.equal(sha(restoreCashierVoidRecovery(read(file),file)),pin.baselineSha256,file);assert.ok(pin.edits.length);assert.throws(()=>restoreCashierVoidRecovery(read(file)+'\n// unrelated mutation\n',file),/(?:Only the reviewed automatic branch hooks|Only the reviewed receipt recovery|Only the reviewed (?:actual|measured)-prep)/);}
 for(const [file,hash]of Object.entries(proof.newFiles))assert.equal(sha(read(file)),hash,file);
 for(const file of ['Takodeal-POS/pos-safety.js','takodeal-manager/pos-safety.js'])assert.equal(sha(read(file)),'415cdfb522de4da80de4e821369371d03d95879548336c055d3f4ab7ba7f495e');
});
test('release includes both new modules, retains all local queue/photo identities and scopes hosted checks to this branch',()=>{
 const sw=read('Takodeal-POS/sw.js');for(const file of ['cashier-void-review.js','cashier-void-sales.js'])assert.ok(sw.includes("'./"+file+"'"));assert.match(sw,/core-cashier-large-delivery-20261114-r1/);assert.match(sw,/const PHOTOS = 'takodeal-pos-photos-offline02'/);assert.doesNotMatch(sw,/deleteDatabase|localStorage\.clear/);
 assert.equal(read('.github/workflows/cashier-void-recovery-checks.yml').replaceAll('Cashier original receipt correction branch checks','Cashier Owner desktop branch checks').replaceAll('fix/cashier-void-recovery','fix/cashier-void-handoff').replaceAll('cashier-original-void-','cashier-owner-desktop-'),read('.github/workflows/cashier-owner-desktop-checks.yml'));
 const access=read('Takodeal-POS/cashier-void-access.js');assert.doesNotMatch(access,/createCashierStaffAccess|\.login\(|\.logout\(|flushLogout|staff-login|staff-logout/);assert.match(access,/purpose:'receipt-void'/);
});
