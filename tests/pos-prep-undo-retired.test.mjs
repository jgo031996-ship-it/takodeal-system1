import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const main=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
const handlerStart=main.indexOf('window.undoKitchenPrep ='),handlerEnd=main.indexOf('// 🧹 DEDICATED CONSUMABLES',handlerStart),handler=main.slice(handlerStart,handlerEnd);
const historyStart=main.indexOf('window.loadKitchenPrepHistory ='),history=main.slice(historyStart,handlerStart);
function fixture(){
 const calls={reads:0,writes:0,deletes:0,refresh:0},dialogs=[],body={innerHTML:'<tr><td>Saved sample history</td></tr>'},source={id:'legacy-source',item:'Sample sauce',variance:1000,uom:'gram',purchQty:1,purchUom:'Batch'},stocks=new Map([['sauce',1000],['raw',3000]]);
 const read=()=>{calls.reads++;throw Error('The retired action must not read Firebase or current recipes');},write=()=>{calls.writes++;throw Error('The retired action must not write Firebase');},remove=()=>{calls.deletes++;throw Error('The saved history must not be deleted');};
 const blocked={getDoc:read,getDocs:read,getDocFromServer:read,getDocsFromServer:read,onSnapshot:read,doc:read,collection:read,query:read,updateDoc:write,setDoc:write,addDoc:write,writeBatch:write,runTransaction:write,deleteDoc:remove};
 const context=vm.createContext({window:{...blocked,loadKitchenPrepHistory:()=>calls.refresh++},...blocked,db:{},document:{getElementById:id=>id==='kitchenPrepHistoryBody'?body:null},localStorage:{getItem:read},fetch:read,confirm:()=>{throw Error('No automatic reversal confirmation is permitted');},Swal:{fire:async options=>{dialogs.push(options);return{isConfirmed:true};}},console});
 vm.runInContext(handler,context);return{context,calls,dialogs,body,source,stocks};
}
test('actual retired handler makes zero Firebase reads, writes or deletes and preserves stock and displayed history',async()=>{
 const f=fixture(),before=structuredClone({history:f.body.innerHTML,source:f.source,stocks:[...f.stocks]});await f.context.window.undoKitchenPrep('legacy-source','Sample sauce',1000);
 assert.deepEqual(f.calls,{reads:0,writes:0,deletes:0,refresh:0});assert.deepEqual({history:f.body.innerHTML,source:f.source,stocks:[...f.stocks]},before);
 assert.equal(f.dialogs[0].titleText,'Owner review required');assert.match(f.dialogs[0].text,/saved prep history stays on file/);assert.match(f.dialogs[0].text,/without verified ingredient movements/);assert.match(f.dialogs[0].text,/cannot be safely undone from the current recipe/);assert.equal(f.dialogs[0].confirmButtonText,'Keep saved history');
});
test('invalid legacy arguments and repeated or simultaneous calls cannot restore stock, query a recipe or remove history',async()=>{
 const f=fixture(),sentinel={toString(){throw Error('Legacy arguments must not be interpreted');},valueOf(){throw Error('Legacy quantities must not be interpreted');}},inputs=[[],[null,null,null],['../foreign','<script>attack</script>',Infinity],[sentinel,sentinel,sentinel],['legacy-source','Sample sauce',-1000]];
 for(const args of inputs)await f.context.window.undoKitchenPrep(...args);await Promise.all(Array.from({length:10},()=>f.context.window.undoKitchenPrep('legacy-source','Sample sauce',1000)));
 assert.deepEqual(f.calls,{reads:0,writes:0,deletes:0,refresh:0});assert.equal(f.dialogs.length,15);assert.equal(f.body.innerHTML,'<tr><td>Saved sample history</td></tr>');assert.deepEqual([...f.stocks],[['sauce',1000],['raw',3000]]);assert.equal(f.source.id,'legacy-source');
});
test('actual prep history renders Owner review and its real click makes no extra Firebase call or history change',async()=>{
 const f=fixture();f.context.localStorage={getItem:()=> 'Sample Branch'};f.context.collection=(_db,table)=>table;f.context.where=(...args)=>args;f.context.query=(...args)=>args;f.context.getDocs=async()=>{f.calls.reads++;return{forEach:visit=>visit({id:f.source.id,data:()=>({...f.source,type:'End-of-Shift Kitchen Prep',timestamp:{valueOf:()=>1,toDate:()=>new Date('2030-01-01T12:00:00Z')}})})};};
 vm.runInContext(history,f.context);await f.context.window.loadKitchenPrepHistory();assert.equal(f.calls.reads,1);assert.match(f.body.innerHTML,/>Owner review<\/button>/);assert.doesNotMatch(f.body.innerHTML,/>✖ Undo<\/button>/);const click=/onclick="([^"]+)"/.exec(f.body.innerHTML)?.[1];assert.equal(click,'window.undoKitchenPrep()');const before=f.body.innerHTML;f.calls.reads=0;
 await vm.runInContext(click,f.context);assert.deepEqual(f.calls,{reads:0,writes:0,deletes:0,refresh:0});assert.equal(f.body.innerHTML,before);assert.equal(f.dialogs.length,1);assert.equal(f.source.id,'legacy-source');
});
