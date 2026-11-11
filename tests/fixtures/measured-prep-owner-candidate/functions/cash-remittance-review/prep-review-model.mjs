import {createHash} from 'node:crypto';
import {PrepModelError,prepCanonical,prepId,prepTimestampToken} from './prep-model.mjs';

export class PrepSourceReviewError extends Error{
 constructor(code,message,details={}){super(message);this.name='PrepSourceReviewError';this.issueCode=code;this.details=details;}
}
export const normalizedPrepName=value=>String(value||'').trim().replace(/\s+/g,' ');
const sourceKeys=['id','updateTime','name','branch','category','currentStock','baseUom','uom','purchaseUom','purchUom','conversionRate','conversion','active','blocked','archived','deleted','status'];
const recipeKeys=['id','updateTime','menuItem','ingredientName','qty','baseUom','uom','unit','branch','active','archived','deleted'];
const atom=value=>typeof value==='number'&&!Number.isFinite(value)?{invalidNumber:String(value)}:typeof value==='string'&&value.length>2048?{oversizedStringHash:createHash('sha256').update(value).digest('hex')}:value&&typeof value==='object'?{invalidType:Array.isArray(value)?'array':'object'}:value;
const selected=(row,keys)=>row?Object.fromEntries(keys.filter(key=>row[key]!==undefined).map(key=>[key,atom(row[key])])):null;
export function prepReviewSourceSnapshot({output,recipes=[],ingredientGroups=[],recipeNames=[],outputNames=[],recipeMatch=null}){
 return {output:selected(output,sourceKeys),recipes:recipes.map(row=>selected(row,recipeKeys)).sort((a,b)=>a.id.localeCompare(b.id)),ingredientGroups:ingredientGroups.map(group=>({name:group.name,rows:group.rows.map(row=>selected(row,sourceKeys)).sort((a,b)=>a.id.localeCompare(b.id))})).sort((a,b)=>a.name.localeCompare(b.name)),recipeNames:recipeNames.map(row=>selected(row,['id','updateTime','menuItem'])).sort((a,b)=>a.id.localeCompare(b.id)),outputNames:outputNames.map(row=>selected(row,['id','updateTime','name','category'])).sort((a,b)=>a.id.localeCompare(b.id)),recipeMatch};
}
export function prepSemanticIssue(error){
 if(error instanceof PrepSourceReviewError)return {code:error.issueCode,message:error.message,details:error.details};
 if(error instanceof PrepModelError&&error.skippable===true&&typeof error.issueCode==='string'&&/^[a-z0-9-]{1,80}$/.test(error.issueCode))return {code:error.issueCode,message:error.message,details:error.details||{}};
 return null;
}
export const prepReviewHash=value=>createHash('sha256').update(prepCanonical(value)).digest('hex');
export function prepReviewFingerprint({actor,intent,branch,snapshot,issue,actual=false}){
 return prepReviewHash({version:actual?2:1,kind:actual?'actual-prep-review':'cashier-prep-review',actor,intent,branch,snapshot,issue:{code:issue.code,message:issue.message,details:issue.details}});
}
export function prepReviewSourceReferences(snapshot){
 return {output:snapshot.output?{id:snapshot.output.id,updateTime:snapshot.output.updateTime}:null,recipes:snapshot.recipes.map(row=>({id:row.id,updateTime:row.updateTime})),ingredients:snapshot.ingredientGroups.flatMap(group=>group.rows.map(row=>({id:row.id,updateTime:row.updateTime}))).sort((a,b)=>a.id.localeCompare(b.id)),nameCandidates:[...snapshot.recipeNames.map(row=>({table:'bom',id:row.id,updateTime:row.updateTime})),...snapshot.outputNames.map(row=>({table:'inventory',id:row.id,updateTime:row.updateTime}))]};
}
export function savedPrepReview(row,id){
 const details=row?.issue?.details,detailKeys=['inventoryId','itemName','role','recordedStock','ingredientName','matches'],validDetails=details&&typeof details==='object'&&!Array.isArray(details)&&Object.keys(details).every(key=>detailKeys.includes(key))&&Object.values(details).every(value=>value===null||typeof value==='string'&&value.length<=200||typeof value==='number'&&Number.isFinite(value));
 const actual=row?.version===2&&row.kind==='actual-prep-review'&&row.actualProductionDeclaration==='AdditionalUnloggedProduction'&&prepId(id)&&id.startsWith('actual-prep-');
 if(!row||!(actual||row.version===1&&row.kind==='cashier-prep-review')||row.operationId!==id||row.status!=='Pending'||row.stockPosted!==false||!prepId(row.actorUid)||!prepId(row.staffId)||!prepId(row.deviceId)||!prepId(row.sessionId)||!prepId(row.outputInventoryId)||typeof row.branch!=='string'||!row.branch||row.branch.length>128||typeof row.qty!=='number'||!Number.isFinite(row.qty)||row.qty<=0||row.qty>1e6||typeof row.sourceFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(row.sourceFingerprint)||typeof row.intentHash!=='string'||!/^[a-f0-9]{64}$/.test(row.intentHash)||typeof row.reviewIntentHash!=='string'||!/^[a-f0-9]{64}$/.test(row.reviewIntentHash)||!row.issue||Object.keys(row.issue).some(key=>!['code','message','details'].includes(key))||typeof row.issue.code!=='string'||!/^[a-z0-9-]{1,80}$/.test(row.issue.code)||typeof row.issue.message!=='string'||row.issue.message.length>2000||!validDetails||!row.sources||row.sources.output&&!prepTimestampToken(row.sources.output.updateTime))throw new PrepSourceReviewError('saved-review-invalid','The saved prep review is incomplete. Ask the Owner to review its original reference.');
 return row;
}
