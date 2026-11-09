// Public SDK methods only. Each action retains its original account/branch
// guard through awaited reads, transaction retries, writes and live callbacks.
export function bindCashierOperationalSdk(api,guard,{registerStop=()=>()=>{}}={}){
 const result={},checked=work=>{guard();return Promise.resolve(work()).then(value=>{guard();return value;});};
 for(const name of ['doc','collection','query','where','limit','orderBy','startAfter','serverTimestamp','increment'])if(typeof api[name]==='function')result[name]=(...args)=>{guard();return api[name](...args);};
 for(const name of ['getDoc','getDocs','getDocFromServer','getDocsFromServer','addDoc','setDoc','updateDoc','deleteDoc'])if(typeof api[name]==='function')result[name]=(...args)=>checked(()=>api[name](...args));
 if(typeof api.runTransaction==='function')result.runTransaction=(db,work,...options)=>checked(()=>api.runTransaction(db,transaction=>{guard();const wrapped={};for(const name of ['get','getAll'])if(typeof transaction[name]==='function')wrapped[name]=(...args)=>checked(()=>transaction[name](...args));for(const name of ['set','create','update','delete'])if(typeof transaction[name]==='function')wrapped[name]=(...args)=>{guard();transaction[name](...args);return wrapped;};return Promise.resolve(work(wrapped)).then(value=>{guard();return value;});},...options));
 if(typeof api.writeBatch==='function')result.writeBatch=(...args)=>{guard();const batch=api.writeBatch(...args),wrapped={};for(const name of ['set','update','delete'])if(typeof batch[name]==='function')wrapped[name]=(...values)=>{guard();batch[name](...values);return wrapped;};wrapped.commit=()=>checked(()=>batch.commit());return wrapped;};
 if(typeof api.onSnapshot==='function')result.onSnapshot=(...args)=>{
  guard();let active=true,unsubscribe,remove=()=>{};const stop=()=>{if(!active)return;active=false;unsubscribe?.();remove();};
  const current=()=>{if(!active)return false;try{guard();return true;}catch{stop();return false;}};
  const index=args.findIndex((value,at)=>at>0&&typeof value==='function');if(index<0)throw Error('Use a guarded snapshot callback.');
  const next=args[index],error=args[index+1];args[index]=(...values)=>{if(current())return next(...values);};if(typeof error==='function')args[index+1]=(...values)=>{if(current())return error(...values);};
  unsubscribe=api.onSnapshot(...args);if(active)remove=registerStop(stop);else unsubscribe?.();return stop;
 };
 return result;
}
