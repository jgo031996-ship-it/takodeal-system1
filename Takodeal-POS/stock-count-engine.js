import {createCountSnapshot} from './stock-report-units.js';
import {units,stockCycle} from './stock-cycle.js';
const safeId=id=>{if(!/^[-\w]{1,180}$/.test(id||''))throw Error('Invalid saved inventory or submission ID.');return id;};
const qty=value=>{if(value==null||value==='')return 0;const n=Number(value);if(!Number.isFinite(n)||n<0)throw Error('Counts must be zero or a positive number.');return n;};
export function countEntries(items,memory){return items.filter(item=>[memory[item.id+'_purch'],memory[item.id+'_base']].some(v=>v!=null&&v!=='')).map(item=>{const u=units(item),p=qty(memory[item.id+'_purch']),b=qty(memory[item.id+'_base']);return {id:safeId(item.id),name:item.name,...u,purchaseCount:p,baseCount:b,physicalQty:p*u.conversionRate+b};});}
export function createStockCountEngine(api,{actor=()=>api.sessionUser}={}){return {async submit({id,branch,cashier,entries}){
    safeId(id);if(!entries.length||entries.length>150||new Set(entries.map(e=>e.id)).size!==entries.length)throw Error('Submit between 1 and 150 different items.');
    const identity=actor(),check=()=>{if(actor()!==identity||identity?.branch!==branch||!branch||!cashier)throw Error('The cashier or branch changed. Sign in again.');};check();
    const intent=JSON.stringify({branch,cashier,entries});const ref=(c,k)=>api.doc(api.db,c,k);
    return api.runTransaction(api.db,async tx=>{const receipt=ref('stock_counts',id),old=await tx.get(receipt);check();if(old.exists()){if(old.data().intent!==intent)throw Error('Submission changed. Reload the saved counts.');return {id,alreadySaved:true,itemCount:entries.length};}
        const snapshots=[];for(const e of entries)snapshots.push(await tx.get(ref('inventory',safeId(e.id))));
        const counts=entries.map((e,i)=>{const snap=snapshots[i];if(!snap.exists())throw Error(`${e.name} is no longer available.`);const live=snap.data(),u=units(live);if(live.branch!==branch||live.name!==e.name||Object.keys(u).some(k=>u[k]!==e[k]))throw Error(`${e.name} changed. Refresh the inventory sheet before submitting.`);
            const countSnapshot=createCountSnapshot({...u,purchaseCount:qty(e.purchaseCount),baseCount:qty(e.baseCount),totalBaseQty:qty(e.physicalQty)}),systemQty=Number(live.currentStock??0);if(!Number.isFinite(systemQty))throw Error(`${e.name} has an invalid recorded balance.`);
            const rawTarget=Number(live.maintainingStock),targetBaseQty=Number.isFinite(rawTarget)&&rawTarget>0?rawTarget:null;
            return {itemId:e.id,name:e.name,physicalQty:e.physicalQty,systemQty,variance:e.physicalQty-systemQty,uom:u.baseUom,cost:Number(live.baseCost??live.cost??live.unitCost??0)||0,countSnapshot,targetSnapshot:{...u,targetBaseQty,cycle:stockCycle(live.restockCycle)}};});
        const items=counts.map(c=>{const u=c.countSnapshot,needed=c.targetSnapshot.targetBaseQty===null?0:Math.max(0,c.targetSnapshot.targetBaseQty-c.physicalQty);return {itemName:c.name,name:c.name,qty:needed,rawQty:needed/u.conversionRate,uom:u.baseUom,...units(u),displayQty:needed/u.conversionRate,displayUom:u.purchaseUom,countSnapshot:u,targetSnapshot:c.targetSnapshot,countReportVersion:2,physicalStock:c.physicalQty,systemStock:c.systemQty,requestType:needed>0?'Below maintaining target':'Target met'};});
        check();const time=api.serverTimestamp();tx.set(receipt,{version:2,id,intent,branch,cashier,counts,timestamp:time});
        for(const c of counts){tx.update(ref('inventory',c.itemId),{currentStock:c.physicalQty});tx.set(ref('stock_logs',id+'-'+c.itemId),{branch,item:c.name,uom:c.uom,oldQty:c.systemQty,newQty:c.physicalQty,variance:c.variance,type:'Staff Physical Count',note:'Cycle count · '+c.targetSnapshot.cycle,countSnapshot:c.countSnapshot,countSubmissionId:id,user:cashier,timestamp:time});}
        if(items.some(i=>i.qty>0))tx.set(ref('purchase_orders',id),{version:2,branch,items,status:'Pending',type:'Cycle Count Report',countSubmissionId:id,requestedBy:cashier,timestamp:time});
        return {id,alreadySaved:false,itemCount:counts.length};
    });
}};}
