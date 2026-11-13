import {restoreLiveBranchDirectory} from './helpers/live-branch-directory-inverse.mjs';
// Apply only the separately hash-verified public discovery patch before these
// historical business/transport byte comparisons. The new source test pins it.
const readFileSync=(path,...args)=>{const value=originalReadFileSync(path,...args),name=path instanceof URL?path.pathname:String(path);if(!name.endsWith('/Takodeal-POS/main.js'))return value;const restored=restoreLiveBranchDirectory(value.toString(),'Takodeal-POS/main.js');return typeof value==='string'?restored:Buffer.from(restored);};
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync as originalReadFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreCashierOwnerDesktop} from './helpers/cashier-owner-desktop-inverse.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),sha=value=>createHash('sha256').update(value).digest('hex');
test('all eleven reviewed Owner desktop hooks have exact inverses; ordinary financial engine and its mirror retain their live bytes',()=>{
 const proof=JSON.parse(read('tests/fixtures/cashier-owner-desktop-inverse.json'));assert.equal(proof.base,'f8f56b31ba4db3b5a7dabe42dab79198294df5b1');assert.equal(Object.keys(proof.files).length,11);
 for(const [file,record]of Object.entries(proof.files)){const source=read(file);assert.equal(sha(restoreCashierOwnerDesktop(source,file)),record.baselineSha256,file);assert.throws(()=>restoreCashierOwnerDesktop(source+'\n// unrelated mutation\n',file),/(?:Only the reviewed automatic branch hooks|Only the reviewed)/);}
 for(const file of ['Takodeal-POS/pos-safety.js','takodeal-manager/pos-safety.js'])assert.equal(sha(read(file)),'415cdfb522de4da80de4e821369371d03d95879548336c055d3f4ab7ba7f495e');
});
test('Owner context is injected only into explicit prep/void actions; offline shell and branch-only CI retain the exact reviewed setup',()=>{
 const main=read('Takodeal-POS/main.js');assert.match(main,/createCashierVoidAccess\(window,\{resolveOwnerDesktop:cashierOwnerDesktopContext\}\)/);assert.match(main,/createCashierPrepAccess\(window,\{resolveOwnerDesktop:cashierOwnerDesktopContext\}\)/);assert.match(main,/createCashierOwnerDesktopContext\(window,\{primaryAuth:auth,primaryDb:db,firebaseConfig,initializeApp,getApps,getAuth,getFirestore\}\)/);
 const source=read('Takodeal-POS/cashier-protected-action.js');assert.doesNotMatch(source,/signInWith|signInAnonymously|\.signOut\(|\.setItem\(|\.removeItem\(/);const sw=read('Takodeal-POS/sw.js');for(const file of ['cashier-protected-action.js','cashier-correction-engine.js'])assert.ok(sw.includes("'./"+file+"'"));assert.match(sw,/const PHOTOS = 'takodeal-pos-photos-offline02'/);
 assert.equal(read('.github/workflows/cashier-owner-desktop-checks.yml').replaceAll('Cashier Owner desktop branch checks','Cashier prep review UI branch checks').replaceAll('fix/cashier-void-handoff','feat/cashier-prep-review-skip').replaceAll('cashier-owner-desktop-','cashier-prep-review-'),read('.github/workflows/cashier-prep-review-ui-checks.yml'));
});
