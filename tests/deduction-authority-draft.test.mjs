import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewDocument} from './helpers/review-dom.mjs';
import {OWNER_DEDUCTION_BASES} from '../takodeal-manager/owner-deduction-model.js';
import {deductionAuthorityDraft,assertCompletedDeductionAuthority,installDeductionAuthorityDraft,DEDUCTION_AUTHORITY_SOURCES} from '../takodeal-manager/deduction-authority-draft.js';
const [legal,court]=OWNER_DEDUCTION_BASES;
test('only the two supported choices prepare a conditional draft; neither fabricates a legal provision or existing order',()=>{
 for(const value of ['',undefined,'Employee agreed','Company policy','Court order already exists'])assert.equal(deductionAuthorityDraft(value,{amount:80,label:'Fictional bowl'}),'');
 const law=deductionAuthorityDraft(legal,{amount:80,label:'Fictional bowl'}),order=deductionAuthorityDraft(court,{amount:80,label:'Fictional bowl'});
 assert.match(law,/₱80\.00.*Fictional bowl/);assert.match(law,/Article 113\(c\)/);assert.match(law,/rule applies/);assert.match(law,/responsibility/);assert.match(law,/reasonable explanation/);assert.match(law,/actual loss/);assert.match(law,/20% weekly/);assert.match(law,/draft alone authorizes no deduction/);
 assert.match(order,/\[Complete the order reference and applicability\]/);assert.match(order,/does not establish that an order exists/);assert.match(order,/request a copy/);assert.doesNotMatch(order,/Order (?:No\.|number|#)\s*\d/);
});
test('missing amounts are described without inventing a charge and incident labels are bounded single-line text',()=>{
 for(const amount of [0,-1,NaN,undefined])assert.match(deductionAuthorityDraft(legal,{amount}),/the proposed amount/);
 const text=deductionAuthorityDraft(legal,{amount:12.5,label:'A\nB\u0000'+ 'x'.repeat(300)});assert.doesNotMatch(text,/[\n\u0000]/);assert.match(text,/₱12\.50/);assert.ok(text.length<1500);
});
test('both untouched placeholders are rejected, while a completed Owner paragraph is returned without rewriting its content',()=>{
 for(const basis of OWNER_DEDUCTION_BASES)assert.throws(()=>assertCompletedDeductionAuthority(deductionAuthorityDraft(basis,{amount:80})),/Complete the specific/);
 assert.throws(()=>assertCompletedDeductionAuthority('[complete the applicable provision and facts]'),/Complete the specific/);
 const value='Fictional applicable provision, verified facts and exact <reference> & explanation.';assert.equal(assertCompletedDeductionAuthority(value),value);
});
function fields(){const d=new ReviewDocument(),select=d.createElement('select'),textarea=d.createElement('textarea'),button=d.createElement('button'),events=[];d.body.append(select,textarea,button);let amount=80;const controller=installDeductionAuthorityDraft(select,textarea,{button,context:()=>({amount,label:'Fictional bowl'}),onDraft:value=>events.push(value)});return{select,textarea,button,events,controller,set amount(value){amount=value;}};}
test('draft generation and untouched amount changes affect only the editable paragraph',()=>{
 const f=fields();assert.equal(f.controller.apply(),false);assert.equal(f.textarea.value,'');f.select.value=legal;f.select.emit('change');assert.match(f.textarea.value,/₱80\.00/);assert.equal(f.controller.wasGenerated(),true);f.amount=50;assert.equal(f.controller.apply(),true);assert.match(f.textarea.value,/₱50\.00/);f.select.value=court;f.select.emit('change');assert.match(f.textarea.value,/order reference/);assert.equal(f.textarea.disabled,false);
});
test('edited and previously saved paragraphs survive basis, amount and fill-button changes until explicitly cleared',()=>{
 const f=fields();f.select.value=legal;f.select.emit('change');const edit='My completed, reviewed provision and fictional applicability.';f.textarea.value=edit;f.amount=40;f.select.value=court;f.select.emit('change');assert.equal(f.textarea.value,edit);assert.equal(f.controller.apply(),false);f.button.click();assert.equal(f.textarea.value,edit);assert.equal(f.events.at(-1),null);f.textarea.value='';f.button.click();assert.match(f.textarea.value,/order reference/);
 const saved=fields();saved.select.value=legal;saved.textarea.value=edit;assert.equal(saved.controller.apply(),false);assert.equal(saved.textarea.value,edit);
});
test('source links are the exact primary Supreme Court pages and contain no redirect or private recipient',()=>{
 assert.equal(DEDUCTION_AUTHORITY_SOURCES.length,2);for(const source of DEDUCTION_AUTHORITY_SOURCES){const url=new URL(source.url);assert.equal(url.protocol,'https:');assert.equal(url.hostname,'elibrary.judiciary.gov.ph');assert.equal(url.search,'');assert.equal(url.hash,'');assert.match(url.pathname,/^\/thebookshelf\/showdocs\/[12]\/\d+$/);assert.ok(source.title);}
});
