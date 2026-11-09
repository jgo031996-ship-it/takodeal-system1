import {createLowIngredientReader} from './low-ingredient-model.js';
import {formatStockQuantity} from './stock-report-units.js';

export function installCashierLowIngredients(w=window,d=document,{primaryAuth,resolveApi,timeoutMs=10000,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let identity=null,epoch=0,flight=null,dialog=null,ready=false,destroyed=false;const ignored=new Map(),pending=new Map(),seen=new Set();
 const capture=()=>({user:primaryAuth?.currentUser,uid:primaryAuth?.currentUser?.uid,session:w.sessionUser,branch:w.sessionUser?.branch,staffId:w.sessionUser?.staffId});
 const equal=(a,b)=>a&&b&&a.user===b.user&&a.uid===b.uid&&a.session===b.session&&a.branch===b.branch&&a.staffId===b.staffId;
 const close=()=>{if(dialog){dialog.close?.();dialog.remove();dialog=null;}};
 function reset(){epoch++;ignored.clear();pending.clear();seen.clear();ready=false;close();}
 function syncScope(){const next=capture();if(!equal(identity,next)){reset();identity=next;}return identity;}
 const guard=(actor,token)=>{if(destroyed||token!==epoch||!equal(actor,syncScope())||!actor.user?.uid||!actor.staffId||!actor.branch)throw Error('The cashier or branch changed. Reopen Stock Report.');};
 const idle=()=>!w.cart?.length&&!w.isProcessingOrder&&!w.cashierCashCountActive&&!w.cashierRemitSubmitting&&!w.expenseSubmissionFlight&&d.getElementById('receiptModal')?.style.display!=='flex'&&d.getElementById('receiptModal')?.style.display!=='block'&&![...d.querySelectorAll?.('dialog,[role="dialog"],.modal')||[]].some(node=>node!==dialog&&(node.open||node.getClientRects?.().length&&w.getComputedStyle?.(node).display!=='none'));
 function showPending(){
  syncScope();if(destroyed||dialog||!ready||!idle()||!pending.size)return;
  const row=pending.values().next().value,actor=identity,token=epoch;try{guard(actor,token);}catch{return;}
  const make=(tag,text)=>{const node=d.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  dialog=make('dialog');dialog.className='low-ingredient-dialog';dialog.setAttribute('aria-labelledby','lowIngredientTitle');
  const title=make('h2','Ingredient running low');title.id='lowIngredientTitle';const name=make('strong',row.name),quantity=make('p','Recorded stock: '+formatStockQuantity(row.stock)+' '+row.baseUom+'. Low-stock alert: '+formatStockQuantity(row.threshold)+' '+row.baseUom+'.');
  const hint=make('p','Check the physical stock. Input actual stock opens the saved count and audit flow; nothing is changed until you review and save. Ignore lasts for this cashier session until the recorded balance changes or 15 minutes pass.'),actions=make('div'),ignore=make('button','Ignore for now'),input=make('button','Input actual stock');actions.className='low-ingredient-actions';ignore.type=input.type='button';
  const dismiss=()=>{try{guard(actor,token);ignored.set(row.id,{fingerprint:row.fingerprint,at:now()});if(pending.get(row.id)?.fingerprint===row.fingerprint)pending.delete(row.id);}catch{}close();showPending();};
  ignore.addEventListener('click',dismiss);dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
  input.addEventListener('click',async()=>{try{guard(actor,token);if(!idle())throw Error('Finish the current order or open work before entering a stock count.');if(typeof w.openActualIngredientCount!=='function')throw Error('Stock Report is starting. Reopen it to enter this count.');close();ready=false;await w.openActualIngredientCount({inventoryId:row.id,name:row.name,branch:row.branch});guard(actor,token);}catch(error){if(equal(actor,syncScope()))w.Swal?.fire?.('Stock count not opened',error.message,'info');}});
  actions.append(ignore,input);dialog.append(title,name,quantity,hint,actions);d.body.append(dialog);dialog.showModal();
 }
 async function checkSale(request,actor,token){
  guard(actor,token);const resolver=resolveApi||w.ensureStockAuditDevice;if(typeof resolver!=='function')return;
  let timer;try{
   const work=(async()=>{const result=await resolver({action:'check',assertCurrent:()=>guard(actor,token)});guard(actor,token);const api=result?.api||result;return createLowIngredientReader(api).read({...request,assertCurrent:()=>guard(actor,token)});})();
   const rows=await Promise.race([work,new Promise((_,reject)=>{timer=setTimer(()=>reject(Error('Ingredient check timed out.')),timeoutMs);})]);guard(actor,token);
   for(const row of rows){if(row.status!=='low'){ignored.delete(row.id);pending.delete(row.id);continue;}const muted=ignored.get(row.id),age=now()-muted?.at;if(muted?.fingerprint!==row.fingerprint||!(age>=0&&age<15*60*1000)){ignored.delete(row.id);pending.set(row.id,row);}}
   showPending();
  }catch{/* Optional alerts never change the result of a safely saved sale. */}finally{if(timer!==undefined)clearTimer(timer);}
 }
 function committedSale({saleId,branch}={}){
  const actor=syncScope(),token=epoch;if(destroyed||!actor.user?.uid||!actor.staffId||branch!==actor.branch||seen.has(saleId))return Promise.resolve();
  seen.add(saleId);if(seen.size>100)seen.delete(seen.values().next().value);
  const next=(flight||Promise.resolve()).then(()=>checkSale({saleId,branch},actor,token)).catch(()=>{});flight=next;next.finally(()=>{if(flight===next)flight=null;});return next;
 }
 const onPageHide=()=>{reset();identity=null;};w.addEventListener?.('pagehide',onPageHide);
 // No background reads: this only retires a visible reminder after a local
 // staff/branch switch, including legacy sign-out paths without an auth event.
 const scopeTimer=w.setInterval?.(()=>syncScope(),500);scopeTimer?.unref?.();
 const unsubscribe=primaryAuth?.onAuthStateChanged?.(()=>syncScope());
 const controller={committedSale,receiptClosed(){syncScope();ready=true;void Promise.resolve(flight).then(showPending);},reset(){reset();identity=null;},destroy(){destroyed=true;reset();w.clearInterval?.(scopeTimer);unsubscribe?.();w.removeEventListener?.('pagehide',onPageHide);},showPending};
 w.cashierLowStock=controller;return controller;
}
