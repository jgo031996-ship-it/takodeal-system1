import {restoreLiveBranchDirectory} from './helpers/live-branch-directory-inverse.mjs';
// Apply only the separately hash-verified public discovery patch before these
// historical business/transport byte comparisons. The new source test pins it.
const readFileSync=(path,...args)=>{const value=originalReadFileSync(path,...args),name=path instanceof URL?path.pathname:String(path);if(!name.endsWith('/Takodeal-POS/main.js'))return value;const restored=restoreLiveBranchDirectory(value.toString(),'Takodeal-POS/main.js');return typeof value==='string'?restored:Buffer.from(restored);};
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync as originalReadFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {restoreCashierPrepRecovery} from './helpers/cashier-prep-recovery-inverse.mjs';
const root=new URL('../',import.meta.url),proof=JSON.parse(readFileSync(new URL('tests/fixtures/cashier-prep-recovery-inverse.json',root))),sha=value=>createHash('sha256').update(value).digest('hex');
test('the prep recovery inverse restores all four product files to exact live bedf bytes and rejects unrelated mutations',()=>{assert.equal(proof.base,'bedf5b71d71e794fb08aac44db2717d3205a500c');assert.equal(Object.keys(proof.files).length,4);for(const[file,row]of Object.entries(proof.files)){const source=readFileSync(new URL(file,root),'utf8'),baseline=execFileSync('git',['show',proof.base+':'+file],{cwd:root,encoding:'utf8',windowsHide:true}),restored=restoreCashierPrepRecovery(source,file);assert.equal(restored,baseline);assert.equal(sha(restored),row.baselineSha256);assert.throws(()=>restoreCashierPrepRecovery(source+'\n// unrelated change\n',file),/(?:Only the reviewed automatic branch hooks|Only the reviewed prep recovery|Only the reviewed (?:actual|measured)-prep)/);}});
test('entry, checkout, ordinary outbox and recipe engine are exact live bedf outside the four prep files',()=>{for(const file of['Takodeal-POS/main.js','Takodeal-POS/pos-safety.js','Takodeal-POS/pos-checkout.js','Takodeal-POS/cashier-staff-access.js','Takodeal-POS/cashier-protected-action.js','Takodeal-POS/recipe-feed.js']){const baseline=execFileSync('git',['show',proof.base+':'+file],{cwd:root,windowsHide:true});assert.equal(sha(readFileSync(new URL(file,root))),sha(baseline),file);}});
