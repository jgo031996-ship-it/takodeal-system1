import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto,randomUUID} from 'node:crypto';
import {firestoreHarness} from './firestore-harness.mjs';
import {installRiderAccount} from '../../takodeal-delivery/rider-account.js';
import {renderRiderDispatch,riderMoney,escapeRiderText} from '../../takodeal-delivery/rider-dispatch-view.js';
import * as safety from '../../takodeal-delivery/rider-delivery-safety.js';

// Run the real app after its SDK initialization, with a local-only backend.
// Account approval and dispatch rendering are production implementations.
export function riderRuntime({savedId,online=true}={}) {
    const source=readFileSync(new URL('../../takodeal-delivery/main.js',import.meta.url),'utf8');
    const begin=source.indexOf('let riderAccountController=null;');assert.ok(begin>=0,'actual Rider runtime entrypoint exists');
    const backend=firestoreHarness(),nodes=new Map(),subscriptions=[],intervals=new Map(),timeouts=new Map(),events=new Map(),gps=[],writes=[],reads=[];
    const saved=new Map(savedId?[['takodeal_rider_id',savedId]]:[]),authListeners=new Set();let sequence=0;
    const node=id=>{
        if(!nodes.has(id)){
            const classes=new Set(),attributes=new Map();
            nodes.set(id,{id,value:'',files:[],textContent:'',innerText:'',innerHTML:'',disabled:false,dataset:{},style:{display:'none'},
                focus(){},setAttribute:(key,value)=>attributes.set(key,String(value)),getAttribute:key=>attributes.get(key),
                replaceChildren(){this.innerHTML='';},classList:{add:(...values)=>values.forEach(value=>classes.add(value)),remove:(...values)=>values.forEach(value=>classes.delete(value)),contains:value=>classes.has(value),toggle:(value,on)=>{if(on===undefined)on=!classes.has(value);on?classes.add(value):classes.delete(value);return on;}}});
        }
        return nodes.get(id);
    };
    node('authOverlay').style.display='flex';
    const snapshot=reference=>({id:reference.id,ref:reference,metadata:{fromCache:false},exists:()=>backend.docs.has(reference.path),data:()=>structuredClone(backend.get(reference.path))});
    const querySnapshot=rows=>({metadata:{fromCache:false},empty:!rows.length,docs:rows.map(row=>({id:row.id,data:()=>structuredClone(row)})),forEach(fn){this.docs.forEach(fn);},docChanges:()=>rows.map(row=>({type:'added',doc:{id:row.id,data:()=>structuredClone(row)}}))});
    const api={...backend.api,storage:{},auth:{currentUser:{uid:'anonymous-runtime'}},crypto:{subtle:webcrypto.subtle,randomUUID},console:{error(){},warn(){},log(){}},
        where:(field,op,value)=>({field,op,value}),
        getDocFromServer:async reference=>{reads.push({kind:'record',reference});if(h.recordWait)await h.recordWait;if(h.recordError)throw h.recordError;return snapshot(reference);},
        getDocsFromServer:async q=>{reads.push({kind:'query',q});if(h.queryWait)await h.queryWait;if(h.queryError)throw h.queryError;return querySnapshot([...backend.docs].filter(([path,row])=>path.startsWith(q.table+'/') && (q.filters||[]).every(f=>f.op==='in'?f.value.includes(row[f.field]):row[f.field]===f.value)).map(([path,row])=>({...row,id:path.slice(q.table.length+1)})));},
        onSnapshot:(q,options,next,error)=>{if(typeof options==='function'){error=next;next=options;options={};}const sub={q,options,next,error,active:true,stops:0};subscriptions.push(sub);return ()=>{sub.stops++;sub.active=false;};},
        onAuthStateChanged:(_auth,callback)=>{authListeners.add(callback);return ()=>authListeners.delete(callback);},
        ensureAuth:async()=>{if(h.authWait)await h.authWait;if(h.authError)throw h.authError;return api.auth.currentUser;},
        runTransaction:async(db,callback)=>backend.api.runTransaction(db,tx=>callback({...tx,update:(reference,data)=>{writes.push({ref:reference,data});tx.update(reference,data);},set:(reference,data,options)=>{writes.push({ref:reference,data});tx.set(reference,data,options);}})),
        updateDoc:async(reference,data)=>{writes.push({ref:reference,data});backend.put(reference.path,{...backend.get(reference.path),...data});},
        arrayUnion:(...values)=>({values}),ref:(_storage,path)=>({path}),uploadBytes:async(reference)=>({ref:reference}),getDownloadURL:async()=>{throw Error('Unexpected real-photo action in lifecycle test');},
        localStorage:{getItem:key=>saved.get(key)||null,removeItem:key=>saved.delete(key),setItem:(key,value)=>{if(key==='takodeal_rider_id'||/pin|password/i.test(key))throw Error('Cannot persist unverified account credentials');saved.set(key,String(value));}}};
    const addEventListener=(name,callback)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(callback);};
    const window={...api,addEventListener,location:{reload(){}}};
    const context={...api,...safety,window,document:{getElementById:node,visibilityState:'visible',querySelectorAll:()=>[],addEventListener},
        installRiderAccount,renderRiderDispatch,riderMoney,escapeRiderText,installRiderLayout(){},TextEncoder,URL,Date,
        navigator:{onLine:online,geolocation:{getCurrentPosition:(ok,fail,options)=>gps.push({ok,fail,options})}},
        setInterval:(fn,delay)=>{const id=++sequence;intervals.set(id,{fn,delay});return id;},clearInterval:id=>intervals.delete(id),
        setTimeout:(fn,delay)=>{const id=++sequence;timeouts.set(id,{fn,delay});return id;},clearTimeout:id=>timeouts.delete(id),
        Swal:{fire:async()=>({isConfirmed:false}),close(){},showValidationMessage(){}},Audio:class{play(){return Promise.resolve();}pause(){this.paused=true;}}};
    const sandbox=vm.createContext(context);
    const h={window,context,sandbox,backend,node,nodes,subscriptions,intervals,timeouts,gps,writes,reads,saved,
        run:code=>vm.runInContext(code,sandbox),
        put(id,extra={}){const row={name:id==='rider-a'?'Rider A':'Rider B',phone:id==='rider-a'?'09123456789':'09123456780',pin:'1234',status:'active',isAcceptingOrders:true,walletBalance:100,...extra};backend.put('riders/'+id,row);return row;},
        async login(id='rider-a',extra={}){let row=backend.get('riders/'+id);if(!row)row=h.put(id,extra);node('loginPhone').value=row.phone;node('loginPin').value=row.pin;return window.loginRider();},
        emit:(sub,rows)=>sub.next(querySnapshot(rows)),
        emitAccount:(sub,row,{cache=false}={})=>sub.next({id:sub.q.id,metadata:{fromCache:cache},exists:()=>row!==undefined,data:()=>structuredClone(row)}),
        async event(name,data={}){await Promise.all((events.get(name)||[]).map(fn=>fn(data)));await new Promise(setImmediate);},
        setAuth(user){api.auth.currentUser=user;authListeners.forEach(callback=>callback(user));},
        businessSubscriptions:()=>subscriptions.filter(sub=>sub.q.table==='incoming_orders'),
        accountSubscriptions:()=>subscriptions.filter(sub=>sub.q.path?.startsWith('riders/'))};
    h.run(source.slice(begin));return h;
}
