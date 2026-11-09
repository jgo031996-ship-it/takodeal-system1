import {bindCashierOperationalSdk} from './cashier-operational-sdk.js';
export function createCashierOperationLifecycle(raw,{scope=()=>[]}={}){
 let generation=0;const stops=new Set(),sdk={};
 const registerStop=stop=>{stops.add(stop);return()=>stops.delete(stop);};
 function capture(){const before=scope(),epoch=generation;return()=>{const after=scope();if(epoch!==generation||before.length!==after.length||before.some((value,index)=>!Object.is(value,after[index])))throw Error('The account, branch or tablet changed. Reopen this action before continuing.');};}
 for(const name of Object.keys(bindCashierOperationalSdk(raw,()=>{})))sdk[name]=(...args)=>bindCashierOperationalSdk(raw,capture(),{registerStop})[name](...args);
 return{sdk,capture,async run(work){const guard=capture();guard();const result=await work();guard();return result;},invalidate(){generation++;for(const stop of [...stops])stop();stops.clear();},get listenerCount(){return stops.size;}};
}
export function bindCashierPrompt(fire,capture){return function(...args){const guard=capture();guard();if(args[0]&&typeof args[0]==='object'&&typeof args[0].preConfirm==='function'){const original=args[0].preConfirm;args[0]={...args[0],preConfirm:function(...values){guard();const result=original.apply(this,values);return result?.then?Promise.resolve(result).then(value=>{guard();return value;}):(guard(),result);}};}const result=fire.apply(this,args);return result?.then?Promise.resolve(result).then(value=>{guard();return value;}):(guard(),result);};}
