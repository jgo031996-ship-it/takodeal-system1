// Statement parsing stays on this device. Only minimal, immutable match evidence
// is stored after the verified Owner explicitly approves a preview.
export const PAYMENT_RECONCILIATION_VERSION=1;
export const PAYMENT_RECONCILIATION_PROVIDERS=Object.freeze(['GCash','Grab','Foodpanda']);
export const PAYMENT_RECONCILIATION_LIMITS=Object.freeze({rows:5000,branches:60,aliases:20,prefixes:10,scopes:120,scopeRows:2000,transactions:40000,maxCents:1000000000000});
const clean=value=>typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' '):'';
const key=value=>clean(value).toLowerCase();
const bad=message=>{throw Error(message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const canonicalPaymentJSON=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(name=>[name,item[name]])):item);
export function paymentProvider(value){const names={gcash:'GCash',grab:'Grab',foodpanda:'Foodpanda','food panda':'Foodpanda',panda:'Foodpanda'},name=key(value);return Object.hasOwn(names,name)?names[name]:null;}
export function paymentCents(value){
 if(typeof value==='string'){if(!/^\d+(?:\.\d{1,2})?$/.test(value.trim()))bad('Use a positive amount with at most two decimal places.');value=Number(value.trim());}
 if(typeof value!=='number'||!Number.isFinite(value)||value<=0)bad('The payment amount must be positive.');
 const cents=Math.round(value*100);if(!Number.isSafeInteger(cents)||cents>PAYMENT_RECONCILIATION_LIMITS.maxCents||Math.abs(value*100-cents)>0.00001)bad('The payment amount is invalid or contains a fraction of a cent.');return cents;
}
export function paymentTimestamp(value){
 let result;if(value instanceof Date)result=new Date(+value);
 else if(typeof value?.toDate==='function')result=value.toDate();
 else if(typeof value?.toMillis==='function')result=new Date(value.toMillis());
 else if(value&&Number.isSafeInteger(value.seconds))result=new Date(value.seconds*1000+(value.nanoseconds||0)/1e6);
 else if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)){
  if(!validPaymentDay(value.slice(0,10))||Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59)bad('The transaction date is invalid.');result=new Date(value);
 }
 if(!(result instanceof Date)||!Number.isFinite(+result))bad('Use the actual Transaction Date with its declared timezone.');return result;
}
export function validPaymentDay(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T00:00:00Z');return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value;}
export const paymentPHDay=value=>new Date(+paymentTimestamp(value)+8*3600000).toISOString().slice(0,10);
export function paymentDayRange(day){if(!validPaymentDay(day))bad('Choose a valid Philippine calendar day.');const start=new Date(day+'T00:00:00+08:00');return {start,end:new Date(+start+86400000)};}
export function defaultReconciliationSettings(){return {schemaVersion:1,revision:0,branchAliases:[],providers:{GCash:{referencePrefixes:[],orderPrefixes:[],timeToleranceMinutes:15},Grab:{referencePrefixes:[],orderPrefixes:['GF-'],timeToleranceMinutes:15},Foodpanda:{referencePrefixes:[],orderPrefixes:[],timeToleranceMinutes:15}}};}
export function normalizeReconciliationSettings(input){
 if(!object(input)||input.schemaVersion!==1||!Number.isSafeInteger(input.revision)||input.revision<0||!Array.isArray(input.branchAliases)||input.branchAliases.length>PAYMENT_RECONCILIATION_LIMITS.branches||!object(input.providers))bad('The saved statement matching settings need Owner review.');
 const aliases=new Map(),branches=new Set(),branchAliases=input.branchAliases.map(row=>{
  const branch=clean(row?.branch);if(!branch||branch.length>120||branches.has(key(branch))||!Array.isArray(row.aliases)||row.aliases.length>20)bad('Each saved branch needs a unique name and up to 20 merchant aliases.');branches.add(key(branch));
  const names=row.aliases.map(alias=>{const result=clean(alias);if(!result||result.length>120)bad('Merchant aliases must contain 1–120 characters.');return result;});
  for(const name of [branch,...names]){const normalized=key(name);if(aliases.has(normalized)&&aliases.get(normalized)!==branch)bad('A merchant alias points to more than one branch.');aliases.set(normalized,branch);}return {branch,aliases:[...new Set(names)]};
 });
 const providers={};for(const name of PAYMENT_RECONCILIATION_PROVIDERS){const row=input.providers[name];if(!object(row)||!Number.isInteger(row.timeToleranceMinutes)||row.timeToleranceMinutes<0||row.timeToleranceMinutes>120)bad('Choose a matching time tolerance from 0 to 120 minutes.');const prefixes=field=>{if(!Array.isArray(row[field])||row[field].length>10)bad('Use up to 10 explicit reference prefixes.');return [...new Set(row[field].map(value=>{const prefix=clean(value).toUpperCase();if(!prefix||prefix.length>24||!/^[A-Z0-9# _-]+$/.test(prefix))bad('Reference prefixes must be explicit text up to 24 characters.');return prefix;}))];};providers[name]={referencePrefixes:prefixes('referencePrefixes'),orderPrefixes:prefixes('orderPrefixes'),timeToleranceMinutes:row.timeToleranceMinutes};}
 return {schemaVersion:1,revision:input.revision,branchAliases,providers};
}
export function normalizePaymentReference(value,prefixes=[]){
 let result=clean(value).toUpperCase();if(!result||result.length>180||!/^[A-Z0-9# _-]+$/.test(result))return '';
 const ordered=[...prefixes].sort((a,b)=>b.length-a.length);for(const prefix of ordered)if(result.startsWith(prefix)){result=result.slice(prefix.length).trim();break;}
 // Identifiers remain text: zeros and alphanumeric suffixes are significant.
 return /^[A-Z0-9][A-Z0-9_-]*$/.test(result)?result:'';
}
const statementKinds=new Set(['PAYMENT','SALE','MERCHANT PAYMENT','QR PAYMENT','QRPH','QRPH PAYMENT','PAYMENT RECEIVED','ORDER']);
function resolveBranch(alias,settings,scope,provider){
 const matches=settings.branchAliases.filter(row=>[row.branch,...row.aliases].some(name=>key(name)===key(alias)));
 let branch=clean(alias)?matches.length===1?matches[0].branch:null:null;
 if(clean(alias)&&!branch)bad('This merchant alias has no unique saved branch.');
 if(scope){if(!['Grab','Foodpanda'].includes(scope.provider)||scope.branchConfirmed!==true||!settings.branchAliases.some(row=>row.branch===scope.branch))bad('Confirm the platform file’s saved branch.');if(provider!==scope.provider)bad('The selected platform conflicts with this statement row.');if(branch&&branch!==scope.branch)bad('The statement branch conflicts with the confirmed file branch.');if(!branch)branch=scope.branch;}
 if(!branch)bad('Choose a saved merchant alias for this statement row.');return branch;
}
export function normalizeStatementRows(rows,rawSettings,{scope}={}){
 const settings=normalizeReconciliationSettings(rawSettings);if(!Array.isArray(rows)||!rows.length||rows.length>5000)bad('Import between 1 and 5,000 statement rows at a time.');
 const counts=new Map();rows.forEach((row,index)=>{const id=clean(row?.rowId)||String(index+1);counts.set(id,(counts.get(id)||0)+1);});return rows.map((row,index)=>{const rowId=clean(row?.rowId)||String(index+1),base={rowId,index};try{
  if(row?.parseError)bad('The statement parser flagged this row for review.');if(rowId.length>120||counts.get(rowId)!==1)bad('The source file repeats or has an invalid row identifier.');const provider=paymentProvider(row.provider);if(!provider)bad('Choose one supported payment provider.');
  const branch=resolveBranch(row.merchantAlias??row.branch,settings,scope,provider),at=paymentTimestamp(row.transactionAt);
  const status=clean(row.status).toUpperCase(),kind=clean(row.kind).toUpperCase();if(!(provider==='GCash'?['SUCCESS','SUCCESSFUL'].includes(status):['SUCCESS','SUCCESSFUL','PAID','COMPLETED','COMPLETE','DELIVERED'].includes(status)))bad('This is not a completed successful payment.');if(!statementKinds.has(kind))bad('Transfers, fees, refunds and unknown transaction kinds are excluded.');
  const grossCents=row.grossCents!==undefined?(Number.isSafeInteger(row.grossCents)&&row.grossCents>0&&row.grossCents<=PAYMENT_RECONCILIATION_LIMITS.maxCents?row.grossCents:bad('The statement gross amount is invalid.')):paymentCents(row.grossAmount);if(row.grossAmount!==undefined&&paymentCents(row.grossAmount)!==grossCents)bad('Statement gross amount fields disagree.');
  const reference=normalizePaymentReference(row.reference,settings.providers[provider].referencePrefixes),orderId=normalizePaymentReference(row.orderId||row.reference,settings.providers[provider].orderPrefixes),external=provider==='GCash'?reference:orderId;if(!external)bad('A stable external payment or order reference is required.');
  return {...base,eligible:true,provider,branch,day:paymentPHDay(at),grossCents,transactionAt:at.toISOString(),reference,orderId,externalKey:canonicalPaymentJSON(provider==='GCash'?[provider,external]:[provider,branch,paymentPHDay(at),external])};
 }catch(error){return {...base,eligible:false,reason:error.message};}});
}
const posted=new Set(['paid','complete','completed','settled','received']);
function timestampIdentity(value){if(value&&Number.isSafeInteger(value.seconds)&&Number.isInteger(value.nanoseconds)&&value.nanoseconds>=0&&value.nanoseconds<1e9)return {seconds:value.seconds,nanoseconds:value.nanoseconds};const millis=+paymentTimestamp(value),seconds=Math.floor(millis/1000);return {seconds,nanoseconds:Math.round((millis-seconds*1000)*1e6)};}
export function paymentReceiptProjection(row){return {id:row.id,branch:row.branch??null,paymentMethod:row.paymentMethod??null,netTotal:row.netTotal??null,timestamp:timestampIdentity(row.timestamp),status:row.status??null,paymentStatus:row.paymentStatus??null,paymentVerified:row.paymentVerified===true,isPendingSync:row.isPendingSync===true,splitDetails:row.splitDetails??null,preparedCancellation:row.preparedCancellation??null,cancelledFoodSourceId:row.cancelledFoodSourceId??null,cancelled:row.cancelled===true,canceled:row.canceled===true,refunded:row.refunded===true,refundAmount:row.refundAmount??null,paymentReference:row.paymentReference??null,platformOrderId:row.platformOrderId??null,customerName:row.customerName??null};}
export function normalizePaymentReceipt(row,settings){
 if(!row||typeof row.id!=='string'||!/^[A-Za-z0-9_-]{1,180}$/.test(row.id))bad('This receipt has no canonical transaction ID.');
 const provider=paymentProvider(row.paymentMethod);if(!provider||row.paymentVerified===true||row.paymentReconciliationVersion!==undefined||row.paymentReconciliationId)bad('This receipt has prior verification evidence or uses another payment method.');
 if(typeof row.netTotal!=='number')bad('Legacy text-valued receipt totals require manual review.');const grossCents=paymentCents(row.netTotal);
 if(!posted.has(key(row.status))||row.paymentStatus!==undefined&&!posted.has(key(row.paymentStatus))||row.isPendingSync===true||row.preparedCancellation||row.cancelledFoodSourceId||row.cancelled||row.canceled||row.refunded||Number(row.refundAmount)>0||row.splitDetails!=null&&(!Array.isArray(row.splitDetails)||row.splitDetails.length))bad('Canceled, refunded, split or unposted receipts cannot be verified by statement import.');
 if(typeof row.timestamp==='string')bad('Legacy text-valued receipt timestamps require manual review.');const at=paymentTimestamp(row.timestamp),branch=clean(row.branch);if(!settings.branchAliases.some(item=>item.branch===branch))bad('The receipt branch is not configured for statement matching.');
 const explicit=provider==='GCash'?row.paymentReference:row.platformOrderId,fallback=explicit==null||explicit===''?row.customerName:explicit;
 let reference=normalizePaymentReference(fallback,provider==='GCash'?settings.providers[provider].referencePrefixes:settings.providers[provider].orderPrefixes);
 if(provider==='GCash'&&(explicit===undefined||explicit===null||explicit==='')&&!/\d/.test(reference))reference='';
 if(explicit!==undefined&&explicit!==null&&explicit!==''&&!reference)bad('The saved explicit payment reference is invalid.');if(provider!=='GCash'&&!reference)bad('The saved platform order ID needs review.');
 return {id:row.id,provider,branch,day:paymentPHDay(at),grossCents,at:+at,reference,explicit:explicit!==undefined&&explicit!==null&&explicit!=='',projection:paymentReceiptProjection(row)};
}
export async function paymentSHA256(value,cryptoImpl=globalThis.crypto){if(!cryptoImpl?.subtle)bad('Secure statement fingerprinting is unavailable on this device.');const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function buildPaymentReconciliationPlan({fileSha256,rows,transactions,settings:rawSettings,scope,crypto=globalThis.crypto}={}){
 if(typeof fileSha256!=='string'||!/^[a-f0-9]{64}$/.test(fileSha256)||!Array.isArray(transactions)||transactions.length>40000)bad('Choose a bounded statement file and fresh transaction records.');const settings=normalizeReconciliationSettings(rawSettings),normalized=normalizeStatementRows(rows,settings,{scope}),receipts=[],duplicates=new Set(),seen=new Set();
 for(const row of transactions){if(seen.has(row.id)){duplicates.add(row.id);continue;}seen.add(row.id);try{receipts.push(normalizePaymentReceipt(row,settings));}catch{/* Excluded receipts never become candidates. */}}
 const externalCounts=new Map();for(const row of normalized)if(row.eligible)externalCounts.set(row.externalKey,(externalCounts.get(row.externalKey)||0)+1);
 const choices=new Map(),reasons=new Map();for(const row of normalized){if(!row.eligible){reasons.set(row.index,row.reason);continue;}if(externalCounts.get(row.externalKey)!==1){reasons.set(row.index,'Duplicate external statement reference; review both source rows.');continue;}
  const scoped=receipts.filter(tx=>!duplicates.has(tx.id)&&tx.provider===row.provider&&tx.branch===row.branch&&tx.day===row.day&&tx.grossCents===row.grossCents&&(row.provider==='GCash'?(!tx.reference||tx.reference===row.reference):tx.reference===row.orderId)).map(tx=>({tx,distance:Math.abs(tx.at-Date.parse(row.transactionAt))})),withinWindow=item=>item.distance<=settings.providers[row.provider].timeToleranceMinutes*60000;
  const exact=row.provider==='GCash'?scoped.filter(item=>item.tx.reference&&item.tx.reference===row.reference):[];
  if(exact.length>1){reasons.set(row.index,'More than one receipt has this exact payment reference; review the duplicate receipts.');continue;}
  if(exact.length===1){if(withinWindow(exact[0]))choices.set(row.index,exact[0]);else reasons.set(row.index,'The receipt with this exact payment reference is outside the saved time window; review its transaction time.');continue;}
  const candidates=scoped.filter(withinWindow);
  candidates.sort((a,b)=>a.distance-b.distance);if(!candidates.length)reasons.set(row.index,'No exact branch/day/amount/reference receipt within the saved time window.');else if(candidates.length>1&&candidates[0].distance===candidates[1].distance)reasons.set(row.index,'Two receipts are equally close; no automatic verification.');else choices.set(row.index,candidates[0]);
 }
 const used=new Map();for(const [index,{tx}]of choices){if(!used.has(tx.id))used.set(tx.id,[]);used.get(tx.id).push(index);}for(const indices of used.values())if(indices.length>1)for(const index of indices){choices.delete(index);reasons.set(index,'More than one statement row selects this receipt; review the collision.');}
 const matches=[];for(const row of normalized){const choice=choices.get(row.index);if(!choice)continue;matches.push({rowId:row.rowId,rowIndex:row.index,transactionId:choice.tx.id,provider:row.provider,branch:row.branch,day:row.day,grossCents:row.grossCents,statementAt:row.transactionAt,sourceAt:new Date(choice.tx.at).toISOString(),claimId:await paymentSHA256(row.externalKey,crypto),sourceFingerprint:await paymentSHA256(canonicalPaymentJSON(choice.tx.projection),crypto),source:choice.tx.projection});}
 const unresolved=normalized.filter(row=>!choices.has(row.index)).map(row=>({rowId:row.rowId,rowIndex:row.index,reason:reasons.get(row.index)||'This row needs review.'}));return {schemaVersion:1,fileSha256,rowCount:rows.length,settingsRevision:settings.revision,settingsFingerprint:await paymentSHA256(canonicalPaymentJSON(settings),crypto),scope:scope?{...scope}:null,matches,unresolved};
}
