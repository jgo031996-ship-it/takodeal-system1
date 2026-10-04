import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {buildMenu,withinBranchHours,readCart,readMenuCache,writeMenuCache,validateCart,escapeHTML,encodeItem,MENU_TTL,MENU_CACHE_KEY} from '../Customer/customer-menu.js';
const item=(name,category='Takoyaki',price=80,other={})=>({id:name,name,category,price,...other});
const branch={name:'Cabantian',allowedCategories:['Takoyaki','Coffee']};
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
test('internal prep, packaging and duplicate extra SKUs never appear as standalone customer products',()=>{
 const rows=['Prep Batch','Prepared Batch','Consumables','Raw Ingredients','Kitchen Prep','TAKEOUT PACKAGING','Extras'].map(cat=>item(cat,cat));
 assert.equal(buildMenu([...rows,item('Original 6 Pcs')],{}).menu.length,1);
});
test('branch category configuration is obeyed, including explicit empty configuration',()=>{
 const raw=[item('A'),item('B','Coffee'),item('C','Tea')];
 assert.equal(buildMenu(raw,branch).menu.length,2);assert.equal(buildMenu(raw,{name:'Maa',allowedCategories:[]}).menu.length,0);assert.equal(buildMenu(raw,{}).menu.length,3);
});
test('disabled, malformed, negative price and nameless items are filtered',()=>{
 const raw=[item('A','Takoyaki',-1),item('B','Takoyaki','bad'),item(''),item('C','Takoyaki',80,{isAvailable:false}),item('D','Takoyaki',80,{customerVisible:false}),item('E','Takoyaki',0)];
 assert.deepEqual(buildMenu(raw,branch).menu.map(i=>i.name),['E']);
});
test('available size sets starting price, preserves actual SKU id and does not mutate cached items',()=>{
 const raw=[item('Original 6 Pcs','Takoyaki',70,{unavailableAt:['Cabantian']}),item('Original 10 Pcs','Takoyaki',130)];const before=JSON.stringify(raw);
 const result=buildMenu(raw,branch);const group=result.menu[0];assert.equal(group.price,130);assert.equal(group.isSoldOut,false);assert.equal(result.variants[group.variantKey].filter(v=>!v.isSoldOut)[0].id,'Original 10 Pcs');assert.equal(JSON.stringify(raw),before);
});
test('all sold-out variants retain a visible unavailable product with no purchasable sizes',()=>{
 const raw=[6,10].map(n=>item('Original '+n+' Pcs','Takoyaki',n*10,{unavailableAt:['Cabantian']}));const r=buildMenu(raw,branch);assert.equal(r.menu[0].isSoldOut,true);assert.equal(r.variants[r.menu[0].variantKey].filter(v=>!v.isSoldOut).length,0);
});
test('identical base names in different categories never share size or recipe data',()=>{
 const r=buildMenu([item('Original 6 Pcs','Takoyaki',70),item('Original 6 Pcs','Coffee',90)],branch);assert.equal(r.menu.length,2);assert.notEqual(r.menu[0].variantKey,r.menu[1].variantKey);assert.equal(Object.keys(r.variants).length,2);
});
test('manager category and item display order are preserved',()=>{
 const r=buildMenu([item('A','Takoyaki',80,{displayOrder:2}),item('B','Takoyaki',80,{displayOrder:1}),item('C','Coffee')],{...branch,allowedCategories:['Coffee','Takoyaki']});assert.deepEqual(Object.keys(r.categories),['Coffee','Takoyaki']);assert.deepEqual(r.categories.Takoyaki.map(i=>i.name),['B','A']);
});
test('hours are read in Davao time even on a device using another timezone',()=>{
 const at=t=>new Date('2026-10-04T'+t+'Z');assert.equal(withinBranchHours('10:00 AM - 9:00 PM',at('02:00:00')),true);assert.equal(withinBranchHours('10:00 AM - 9:00 PM',at('13:00:00')),false);assert.equal(withinBranchHours('10:00 AM - 9:00 PM',at('01:59:00')),false);
});
test('overnight opening windows handle both sides of midnight and exclusive closing time',()=>{
 for (const time of ['2026-10-03T23:30:00+08:00','2026-10-04T06:59:00+08:00']) assert.equal(withinBranchHours('9:00 AM – 7:00 AM',new Date(time)),true);
 assert.equal(withinBranchHours('9:00 AM - 7:00 AM',new Date('2026-10-04T07:00:00+08:00')),false);
});
test('unknown hours rely on live branch gate rather than an invented schedule',()=>{
 for (const hours of [undefined,'N/A','invalid','25:00 PM - 9:00 PM']) assert.equal(withinBranchHours(hours),true);
});
test('catalogue cache survives reloads, expires, and rejects future or malformed entries',()=>{
 const s=storage();writeMenuCache(s,[item('A')],1000);assert.equal(readMenuCache(s,1001).length,1);assert.equal(readMenuCache(s,1000+MENU_TTL),null);assert.equal(readMenuCache(s,999),null);s.setItem(MENU_CACHE_KEY,'broken');assert.equal(readMenuCache(s),null);
});
test('storage quota and blocked storage do not prevent menu rendering',()=>{
 const broken={getItem(){throw Error('blocked');},setItem(){throw Error('quota');}};assert.equal(readMenuCache(broken),null);assert.doesNotThrow(()=>writeMenuCache(broken,[]));assert.deepEqual(readCart(broken),[]);
});
test('corrupt and invalid restored carts cannot crash startup',()=>{
 const s=storage();for (const text of ['invalid','{}','null']) {s.setItem('takodeal_customer_cart',text);assert.deepEqual(readCart(s),[]);}
 s.setItem('takodeal_customer_cart',JSON.stringify([{name:'A',quantity:1,price:80,lineTotalFinal:80},{name:'bad',quantity:-1,price:80,lineTotalFinal:-80}]));assert.equal(readCart(s).length,1);
});
const cartLine=extra=>({menuId:'A',name:'A',quantity:2,price:80,lineTotalFinal:190,addons:{Cheese:{name:'Cheese',qty:1,price:15}},...extra});
const raw=[item('A','Takoyaki',80,{addons:[{name:'Cheese',price:15}]})];
test('fresh-cart verification includes quantity and add-on totals',()=>assert.equal(validateCart([cartLine()],raw,branch),190));
test('changed menu price, removed item or sold-out item blocks stale cart submission',()=>{
 assert.throws(()=>validateCart([cartLine()],[],branch),/unavailable/);assert.throws(()=>validateCart([cartLine()],[{...raw[0],price:90}],branch),/price/);assert.throws(()=>validateCart([cartLine()],[{...raw[0],unavailableAt:['Cabantian']}],branch),/unavailable/);
});
test('branch-disabled categories and duplicate legacy item names block submission',()=>{
 assert.throws(()=>validateCart([cartLine()],raw,{name:'Maa',allowedCategories:[]}),/unavailable/);
 assert.throws(()=>validateCart([cartLine({menuId:undefined})],[...raw,...raw],branch),/unavailable/);
});
test('invalid quantities, altered totals and removed or re-priced add-ons block submission',()=>{
 assert.throws(()=>validateCart([cartLine({quantity:.5})],raw,branch),/quantities/);
 assert.throws(()=>validateCart([cartLine({lineTotalFinal:1})],raw,branch),/totals/);
 assert.throws(()=>validateCart([cartLine()],[{...raw[0],addons:[]}],branch),/add-ons/);
 assert.throws(()=>validateCart([cartLine()],[{...raw[0],addons:[{name:'Cheese',price:20}]}],branch),/add-ons/);
});
test('existing free base sauce selection remains valid',()=>{
 const sauceRaw=[item('A','Takoyaki',80,{addons:[{name:'Regular Sauce',price:0}]})];assert.equal(validateCart([cartLine({lineTotalFinal:160,addons:{Sauce:{name:'Spicy Sauce',qty:1,price:0}}})],sauceRaw,branch),160);
});
test('menu and branch names with quotes cannot escape HTML or inline item arguments',()=>{
 const name="Chef's <special> & \"meal\"";assert.equal(escapeHTML(name),'Chef&#39;s &lt;special&gt; &amp; &quot;meal&quot;');assert.ok(!encodeItem({name}).includes("'"));assert.equal(JSON.parse(decodeURIComponent(encodeItem({name}))).name,name);
});
test('actual catalogue loader coalesces requests, reuses disk cache and forces server reads for checkout',async()=>{
 const source=readFileSync(new URL('../Customer/index.html',import.meta.url),'utf8');const start=source.indexOf('        window.TK_CACHE =');const end=source.indexOf('        // 🔥 THE APP NAVIGATION',start);
 const s=storage();let reads=0,serverReads=0;
 const response=()=>({forEach(fn){fn({id:'A',data:()=>({name:'A',price:80})});}});
 const context=vm.createContext({window:{},Date,customerStorage:s,readMenuCache,writeMenuCache,MENU_TTL,db:{},query:q=>q,collection:()=>({}),getDocs:async()=>{reads++;return response();},getDocsFromServer:async()=>{serverReads++;return response();}});
 vm.runInContext(source.slice(start,end),context);const fn=context.window.fetchCachedMenu;
 await Promise.all([fn(),fn(),fn()]);assert.equal(reads,1);await fn();assert.equal(reads,1);context.window.TK_CACHE.menu=null;await fn();assert.equal(reads,1);await fn(true);assert.equal(serverReads,1);
});
test('all customer inline scripts parse after removing duplicate screens and checkout',()=>{
 const html=readFileSync(new URL('../Customer/index.html',import.meta.url),'utf8');
 for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) if (match[1].trim()) assert.doesNotThrow(()=>new vm.Script(match[1].replace(/^\s*import[^\n]+$/gm,'')));
});
function gateFixture() {
 const h=firestoreHarness();h.put('branches/Cabantian',branch);h.put('settings/status_Cabantian',{mobileOrdersActive:true});h.put('offline_policy/Cabantian',{});
 const html=readFileSync(new URL('../Customer/index.html',import.meta.url),'utf8'),start=html.indexOf('function takodealBranchAvailable'),end=html.indexOf('</script>',start);
 const snapshot=ref=>({exists:()=>h.get(ref.path)!==undefined,data:()=>h.get(ref.path)});
 const state={currentUser:{email:'customer@example.test'},customerCartBranch:'Cabantian',customerBranchData:new Map(),fetchCachedMenu:async()=>state.menu};state.menu=raw;
 const context=vm.createContext({window:state,navigator:{onLine:true},sessionStorage:storage(),crypto:{randomUUID},setInterval:()=>{},withinBranchHours,validateCart,Date,db:h.api.db,doc:h.api.doc,collection:h.api.collection,query:h.api.query,where:h.api.where,tkCustomerTransaction:h.api.runTransaction,tkCustomerGetServerDoc:async ref=>snapshot(ref),getDocsFromServer:async q=>{const result=await h.api.getDocsFromServer(q);return {...result,size:result.docs.length};}});
 vm.runInContext(html.slice(start,end),context);const payload={orderCode:'TEST-001',branch:'Cabantian',customerEmail:state.currentUser.email,orderType:'Takeout',items:[cartLine()],totalAmount:190};return {h,state,gate:state.TKCustomerGate,payload};
}
test('actual submission preserves one order through repeated retries and lost acknowledgements',async()=>{
 const {h,gate,payload}=gateFixture();h.loseNextAck();await assert.rejects(gate.saveOrder(payload),/Connection lost/);
 for (let n=0;n<10;n++) assert.equal(await gate.saveOrder(payload),'TEST-001');assert.equal([...h.docs.keys()].filter(k=>k.startsWith('incoming_orders/')).length,1);
});
test('actual submission validates fresh server menu and authentication before writing an order',async()=>{
 const {h,state,gate,payload}=gateFixture();state.menu=[{...raw[0],price:100}];await assert.rejects(gate.saveOrder(payload),/price/);state.menu=raw;state.currentUser=null;await assert.rejects(gate.saveOrder(payload),/sign in/);assert.equal([...h.docs.keys()].filter(k=>k.startsWith('incoming_orders/')).length,0);
});
test('actual transaction refuses paused branches and stale cashier leases without leaving an offline write',async()=>{
 const {h,gate,payload}=gateFixture();h.put('settings/status_Cabantian',{mobileOrdersActive:false});await assert.rejects(gate.saveOrder(payload),/unavailable/);
 h.put('settings/status_Cabantian',{mobileOrdersActive:true});h.put('offline_policy/Cabantian',{requireCashierForCustomerOrders:true});h.put('cashier_leases/Cabantian',{seenAt:{seconds:0}});await assert.rejects(gate.saveOrder(payload),/unavailable/);assert.equal([...h.docs.keys()].filter(k=>k.startsWith('incoming_orders/')).length,0);
});
