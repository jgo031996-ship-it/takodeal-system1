import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 CUSTOMER_SITE_PROFILE_DOC,DEFAULT_CUSTOMER_SITE_PROFILE,customerSiteProfile,
 validateCustomerSiteProfile,customerSiteFooter,branchOpeningNotice,validateBranchOpeningNotice
} from '../Customer/customer-site-settings.js';

const currentYear=new Date().getFullYear();
const profile=extra=>({businessName:'TAKODEÁL',location:'Davao City',sinceYear:2023,aboutText:'Freshly prepared takoyaki.',...extra});

test('Customer and Manager share the exact same site-settings contract',()=>{
 const customer=readFileSync(new URL('../Customer/customer-site-settings.js',import.meta.url),'utf8');
 const manager=readFileSync(new URL('../takodeal-manager/customer-site-settings.js',import.meta.url),'utf8');
 assert.equal(customer,manager);assert.equal(CUSTOMER_SITE_PROFILE_DOC,'customer_site_profile');
});
test('Missing or malformed settings safely retain TAKODEÁL, Davao City and Since 2023',()=>{
 assert.deepEqual(DEFAULT_CUSTOMER_SITE_PROFILE,{businessName:'TAKODEÁL',location:'Davao City',sinceYear:2023,aboutText:''});
 for(const value of [undefined,null,{},false,42,'legacy text',[]])assert.deepEqual(customerSiteProfile(value),DEFAULT_CUSTOMER_SITE_PROFILE);
 assert.equal(customerSiteFooter(),'TAKODEÁL · Davao City · Since 2023');assert.ok(Object.isFrozen(DEFAULT_CUSTOMER_SITE_PROFILE));
});
test('Normalized profiles trim fields, preserve multiline plain text and ignore unrelated settings',()=>{
 const input=profile({businessName:'  New TAKODEÁL  ',location:'  Davao  ',sinceYear:' 2023 ',aboutText:'  First line.\nSecond line.  ',paymentMethods:['Cash']});
 const before=JSON.stringify(input);
 assert.deepEqual(customerSiteProfile(input),{businessName:'New TAKODEÁL',location:'Davao',sinceYear:2023,aboutText:'First line.\nSecond line.'});
 assert.equal(JSON.stringify(input),before);
});
test('Public settings normalization limits text lengths and falls back for non-text values',()=>{
 const result=customerSiteProfile(profile({businessName:'A'.repeat(81),location:'B'.repeat(81),aboutText:'C'.repeat(1201)}));
 assert.equal(result.businessName.length,80);assert.equal(result.location.length,80);assert.equal(result.aboutText.length,1200);
 for(const invalid of ['', '   ',null,undefined,12,true,[],{}]){
  assert.deepEqual(customerSiteProfile(profile({businessName:invalid,location:invalid,aboutText:invalid})),DEFAULT_CUSTOMER_SITE_PROFILE);
 }
});
test('Founding year normalization accepts bounded integers and decimal UI strings only',()=>{
 for(const value of [1900,'1900',2023,'2023',' 2023 ',currentYear,String(currentYear)])assert.equal(customerSiteProfile(profile({sinceYear:value})).sinceYear,Number(value));
 for(const value of [1899,currentYear+1,2023.5,'2023.5','', ' ',null,undefined,false,true,NaN,Infinity,[],[2024],{}, {valueOf:()=>2024},'0x7e8','2.024e3','+2024','2023x']){
  assert.equal(customerSiteProfile(profile({sinceYear:value})).sinceYear,2023);
 }
});
test('Normalized profiles are independent snapshots and do not change shared defaults',()=>{
 const first=customerSiteProfile();first.businessName='Changed only locally';
 assert.equal(customerSiteProfile().businessName,'TAKODEÁL');assert.equal(DEFAULT_CUSTOMER_SITE_PROFILE.businessName,'TAKODEÁL');
});
test('Strict profile validation returns only trimmed editable fields and accepts exact limits',()=>{
 const input=profile({businessName:' '+ 'A'.repeat(80)+' ',location:' '+ 'B'.repeat(80)+' ',sinceYear:'2023',aboutText:' '+ 'C'.repeat(1200)+' ',other:true});
 const result=validateCustomerSiteProfile(input,2026);
 assert.deepEqual(result,{businessName:'A'.repeat(80),location:'B'.repeat(80),sinceYear:2023,aboutText:'C'.repeat(1200)});
 assert.equal(input.other,true);assert.equal(input.sinceYear,'2023');
});
test('Strict validation refuses empty, oversized or wrongly typed business names and locations',()=>{
 for(const value of ['', ' ',null,undefined,false,12,[],{},'A'.repeat(81)]){
  assert.throws(()=>validateCustomerSiteProfile(profile({businessName:value}),2026),/business name/i);
  assert.throws(()=>validateCustomerSiteProfile(profile({location:value}),2026),/location/i);
 }
 for(const value of [undefined,null,{},false,'legacy'])assert.throws(()=>validateCustomerSiteProfile(value,2026));
});
test('Strict founding-year validation rejects malformed types, coercions and out-of-range dates',()=>{
 for(const value of [1900,'1900',2026,'2026',' 2023 '])assert.equal(validateCustomerSiteProfile(profile({sinceYear:value}),2026).sinceYear,Number(value));
 for(const value of [1899,2027,2023.5,'2023.5','', ' ',null,undefined,false,true,NaN,Infinity,[],[2023],{}, {valueOf:()=>2023},'0x7e7','2.023e3','+2023','2023x']){
  assert.throws(()=>validateCustomerSiteProfile(profile({sinceYear:value}),2026),/founding year/i);
 }
});
test('An empty About description is valid while oversized or non-text descriptions are refused',()=>{
 assert.equal(validateCustomerSiteProfile(profile({aboutText:'  \n '}),2026).aboutText,'');
 for(const value of [null,undefined,12,true,[],{},'A'.repeat(1201)])assert.throws(()=>validateCustomerSiteProfile(profile({aboutText:value}),2026),/description/i);
});
test('Footer formatting uses the saved business, location and founding year with safe defaults',()=>{
 assert.equal(customerSiteFooter(profile({businessName:'  TAKODEÁL & Co.  ',location:'  Maa, Davao City ',sinceYear:'2024'})),'TAKODEÁL & Co. · Maa, Davao City · Since 2024');
 assert.equal(customerSiteFooter({businessName:null,location:false,sinceYear:currentYear+1}),'TAKODEÁL · Davao City · Since 2023');
});
test('About and watermark models retain plain text for safe text rendering by consumers',()=>{
 const name='TAKODEÁL <sample> & "partners"',label='Soon <sample> & "opening"';
 assert.equal(customerSiteProfile(profile({businessName:name})).businessName,name);
 assert.equal(branchOpeningNotice({customerSoonToOpen:true,customerOpeningLabel:label}).label,label);
});
test('Only the literal true watermark flag marks a branch as opening soon',()=>{
 assert.equal(branchOpeningNotice({customerSoonToOpen:true,status:'Active'}).soonToOpen,true);
 for(const value of [undefined,null,false,'true','false',1,0,[],{}])assert.equal(branchOpeningNotice({customerSoonToOpen:value}).soonToOpen,false);
 assert.deepEqual(branchOpeningNotice(),{soonToOpen:false,label:'Soon to open'});
});
test('Opening labels trim and cap public values, with a consistent blank/non-text fallback',()=>{
 assert.deepEqual(branchOpeningNotice({customerSoonToOpen:true,customerOpeningLabel:'  Opening in November  '}),{soonToOpen:true,label:'Opening in November'});
 assert.equal(branchOpeningNotice({customerOpeningLabel:'A'.repeat(61)}).label.length,60);
 for(const value of [undefined,null,'','  ',12,true,[],{}])assert.equal(branchOpeningNotice({customerSoonToOpen:true,customerOpeningLabel:value}).label,'Soon to open');
});
test('Strict opening settings accept both boolean choices and a blank fallback label',()=>{
 assert.deepEqual(validateBranchOpeningNotice({customerSoonToOpen:true,customerOpeningLabel:'  Opening in November ',status:'Active'}),{customerSoonToOpen:true,customerOpeningLabel:'Opening in November'});
 assert.deepEqual(validateBranchOpeningNotice({customerSoonToOpen:false,customerOpeningLabel:' '}),{customerSoonToOpen:false,customerOpeningLabel:'Soon to open'});
 assert.equal(validateBranchOpeningNotice({customerSoonToOpen:true,customerOpeningLabel:'A'.repeat(60)}).customerOpeningLabel.length,60);
});
test('Strict opening validation refuses truthy non-booleans and oversized or wrongly typed labels',()=>{
 for(const value of [undefined,null,'true','false',1,0,[],{}])assert.throws(()=>validateBranchOpeningNotice({customerSoonToOpen:value,customerOpeningLabel:'Soon'}),/opening soon/i);
 for(const value of [undefined,null,12,true,[],{},'A'.repeat(61)])assert.throws(()=>validateBranchOpeningNotice({customerSoonToOpen:true,customerOpeningLabel:value}),/watermark/i);
 for(const value of [undefined,null,{}])assert.throws(()=>validateBranchOpeningNotice(value));
});
