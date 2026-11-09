import {webcrypto} from 'node:crypto';
import {buildHQAccessIndex} from '../../functions/cash-remittance-review/company-access-index.mjs';
import {defaultReconciliationSettings,buildPaymentReconciliationPlan} from '../../takodeal-manager/payment-reconciliation-model.js';
export const gcashActor={uid:'synthetic-owner',email:'jgo031996@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
export const gcashAt='2026-10-31T02:00:00.000Z',gcashFile='a'.repeat(64);
export const gcashSettings=()=>({...defaultReconciliationSettings(),revision:1,branchAliases:[{branch:'Maa',aliases:['MAA STORE']},{branch:'Cabantian',aliases:['CAB STORE']}]});
export const gcashRow=(extra={})=>({rowId:'r1',provider:'GCash',merchantAlias:'MAA STORE',transactionAt:gcashAt,status:'SUCCESS',kind:'PAYMENT',grossAmount:'100.00',reference:'00001234',...extra});
export const gcashSale=(extra={})=>({id:'tx-a',branch:'Maa',paymentMethod:'GCash',netTotal:100,timestamp:new Date(gcashAt),status:'Paid',paymentVerified:false,customerName:'00001234',cart:[{name:'Synthetic food',qty:1}],...extra});
export const gcashHQ=(extra={})=>({email:gcashActor.email,role:'Owner',permissions:['all'],assignedBranch:['All'],active:true,pin:'SYNTHETIC_ONLY',...extra});
export function gcashSeed(put,{profile=gcashHQ(),settings=gcashSettings(),sales=[gcashSale()],bridge}={}){
 put('hq_managers/owner',profile);put('hq_account_index/'+gcashActor.email,buildHQAccessIndex([{id:'owner',data:profile}])[0]);
 if(bridge)put('hq_email_access/'+gcashActor.email,bridge);
 put('branches/maa',{name:'Maa',active:true});put('branches/cabantian',{name:'Cabantian',active:true});put('payment_reconciliation_settings/main',settings);
 for(const sale of sales){const {id,...source}=sale;put('transactions/'+id,source);}
 put('cash_accounts/private-bank',{balance:-25});put('payroll_records/paid',{finalNetPay:777,status:'Paid'});
}
export async function gcashBody({rows=[gcashRow()],sales=[gcashSale()],settings=gcashSettings(),fileSha256=gcashFile,automatic=false}={}){
 const plan=await buildPaymentReconciliationPlan({fileSha256,rows,transactions:sales,settings,crypto:webcrypto});
 const evidence=row=>Object.fromEntries(['rowId','rowIndex','transactionId','claimId','sourceFingerprint'].map(key=>[key,row[key]]));
 return{fileSha256,rows,scope:null,settingsRevision:plan.settingsRevision,settingsFingerprint:plan.settingsFingerprint,matches:plan.matches.map(evidence),alreadyVerified:[],automatic};
}
