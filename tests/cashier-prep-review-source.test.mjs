import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restorePrepReviewIntegration} from './helpers/cashier-prep-review-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8'),sha=value=>createHash('sha256').update(value).digest('hex');

test('only the reviewed prep component, styling and release shell change from frozen live void dd8',()=>{
 const proof=JSON.parse(read('tests/fixtures/cashier-prep-review-inverse.json'));assert.equal(proof.base,'dd8c13d5427c17ef7bfa6c0452bfd9a6dc0cc5ff');assert.equal(Object.keys(proof.files).length,5);
 for(const [file,pin]of Object.entries(proof.files)){const source=read(file),restored=restorePrepReviewIntegration(source,file);assert.equal(sha(restored),pin.baselineSha256,file);assert.throws(()=>restorePrepReviewIntegration(source+'\n// unexpected mutation\n',file),/Exact reviewed/,file);}
 const unchanged=JSON.parse(read('tests/fixtures/cashier-prep-review-unchanged.json'));assert.equal(unchanged.base,proof.base);assert.equal(Object.keys(unchanged.files).length,5);for(const [file,hash]of Object.entries(unchanged.files))assert.equal(sha(read(file)),hash,file);
});

test('offline shell includes the actual typed review helper and scoped CI preserves the reviewed runtime checks',()=>{
 const source=read('Takodeal-POS/cashier-prep.js');assert.match(source,/^import \{prepSemanticReview,prepReviewSaved,prepReviewMarkup\} from '\.\/cashier-prep-review\.js';/);assert.match(read('Takodeal-POS/sw.js'),/'\.\/cashier-prep-review\.js'/);
 const workflow=read('.github/workflows/cashier-prep-review-ui-checks.yml'),baseline=read('.github/workflows/cashier-void-checks.yml');
 assert.equal(workflow.replaceAll('Cashier prep review UI branch checks','Cashier void correction branch checks').replaceAll('feat/cashier-prep-review-skip','feat/cashier-void-ui').replaceAll('cashier-prep-review-','cashier-void-'),baseline);
 assert.doesNotMatch(source,/manager_alerts/);
});
