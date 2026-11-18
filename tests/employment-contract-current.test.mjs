import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initialContract,CONTRACT_VERSION} from '../takodeal-staff/employment-contract.mjs';
import {signedContractDocument} from '../takodeal-staff/signed-contract-document.js';
test('Staff, Owner preview and authoritative signup share the same revised agreement',async()=>{
 const paths=['takodeal-staff','takodeal-manager','functions/cash-remittance-review'];
 const modules=await Promise.all(paths.map(p=>readFile(new URL('../'+p+'/employment-contract.mjs',import.meta.url),'utf8')));assert.equal(new Set(modules).size,1);
 const html=initialContract({branch:'Fictional Branch',role:'Crew',dateHired:'2026-12-01',dailyRate:450},{cashierName:'<Fictional Employee>',address:'Test address'});
 for(const phrase of ['PROBATIONARY STATUS','automatically attain regular employment status','five (5) or six (6)','every 19th and 4th','5th Offense: Termination','No Work, No Pay','4.1 Confidential Information','4.2 Continuing Obligation and Exceptions','4.3 Liquidated Damages','4.4 Enforcement and Due Process','proven, intentional, and material breach','reduce an excessive or unconscionable amount','shall not apply to ordinary attendance violations','seeking legal advice','work-related injury','thirty (30) days written notice','DOLE regulations','one (1) cap and one (1) apron','8. OTHER TERMS AND CONDITIONS','CHERY ANN R. FONDA','WITNESSES','Fictional Branch','₱450.00','Test address','&lt;Fictional Employee&gt;'])assert.ok(html.includes(phrase),phrase);
 assert.equal(html.includes('7th Offense'),false);assert.equal(html.includes('valid for a period of six'),false);assert.ok(html.includes('alt="TAKODEÁL logo"'));assert.ok(html.includes('not yet signed'));
});
test('older signed copies are labeled and printable separately from the unsigned updated template',()=>{
 const saved={contractVersion:'original-v1',currentContractVersion:CONTRACT_VERSION,html:'<p>Original terms and signature</p>',currentHtml:'<p>Current unsigned agreement</p>'},html=signedContractDocument(saved);
 assert.ok(html.includes('Earlier signed version'));assert.ok(html.includes(saved.html));assert.ok(html.includes('id="contract-current" hidden'));assert.ok(html.includes(saved.currentHtml));assert.ok(html.includes('UNSIGNED PREVIEW'));assert.ok(html.includes('does not replace the signed agreement'));assert.equal(html.includes('setTimeout'),false);
});
