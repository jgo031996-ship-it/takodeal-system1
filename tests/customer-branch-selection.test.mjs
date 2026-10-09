import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {withinBranchHours,escapeHTML,validateCart} from '../Customer/customer-menu.js';
import {branchOpeningNotice} from '../Customer/customer-site-settings.js';

const html=readFileSync(new URL('../Customer/index.html',import.meta.url),'utf8');
function section(start,end) {
    const from=html.indexOf(start),to=html.indexOf(end,from);
    assert.ok(from>=0 && to>from,'Actual customer function section: '+start);
    return html.slice(from,to);
}
const selection=section('window.confirmCustomerBranchAvailable = async function','window.loadLiveMenu = async function')+
    section('window.loadBranchLocator = async function','window.currentGrabLink =');
const gateCode=section('function takodealBranchAvailable','</script>');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const snap=value=>({exists:()=>value!==undefined,data:()=>value});
const leaseAt=millis=>({seenAt:{toMillis:()=>millis}});

function harness() {
    const now={value:+new Date('2026-10-09T04:00:00Z')},reads=[],dialogs=[],screens=[],renders=[],cartUpdates=[],nodes=new Map(),documents=new Map(),failures=new Set();
    const branches=[{name:'Maa',operatingHours:'10:00 AM - 9:00 PM',publicAddress:'Maa sample address'},
        {name:'Cabantian',operatingHours:'10:00 AM - 9:00 PM'},
        {name:'Closed',operatingHours:'1:00 PM - 9:00 PM'},
        {name:'Main Office',operatingHours:'N/A'}];
    for(const branch of branches){documents.set('settings/status_'+branch.name,{mobileOrdersActive:true});documents.set('offline_policy/'+branch.name,{});}
    const node=id=>{
        if(!nodes.has(id)){
            const classes=new Set();const result={id,value:'',innerHTML:'',textContent:'',className:'',style:{},children:[],
                classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),contains:value=>classes.has(value),toggle(){}},
                replaceChildren(){this.children=[];this.value='';},appendChild(child){this.children.push(child);this.value=child.value;}};
            nodes.set(id,result);
        }
        return nodes.get(id);
    };
    for(const id of ['homeBranchSelect','selectedBranch'])node(id).value='Cabantian';
    node('headerMenuBranchText').textContent='Cabantian';node('customerBranchAddress').textContent='Old address';
    node('native-lat').value='7';node('native-lng').value='125';node('searchInput').value='keep search';
    const cart=[{menuId:'original',name:'Original',quantity:1,price:80,lineTotalFinal:80}],storage=new Map([['takodeal_customer_cart',JSON.stringify(cart)],['tk_customer_cart_branch','Cabantian']]);
    const window={cart,customerBranchData:new Map(branches.map(branch=>[branch.name,branch])),customerSelectedBranch:'Cabantian',customerCartBranch:'Cabantian',
        isStoreAcceptingOrders:true,currentDeliveryFee:100,customerSelectedCategory:'Takoyaki',nativeMap:{remove(){h.mapRemovals++;}},nativeMarker:{id:'keep marker'},
        closeItemModal(){h.closedItems++;},closeCheckoutModal(){h.closedCheckout++;},
        async renderMenuForBranch(name){renders.push(name);if(h.renderWait)await h.renderWait.promise;},listenToStoreStatus(){h.statusSubscriptions++;},
        loadCustomerSiteProfile(){},
        updateCartUI(){cartUpdates.push(window.cart);},switchScreen:name=>screens.push(name)};
    class ClockDate extends Date {constructor(...args){super(...(args.length?args:[now.value]));}static now(){return now.value;}}
    const read=async(ref,server)=>{
        reads.push({path:ref.path,server});
        if(failures.has(ref.path))throw Error('Mock read refused');
        if(server && h.statusWait && ref.path==='settings/status_Maa')await h.statusWait.promise;
        return snap(documents.get(ref.path));
    };
    const context=vm.createContext({window,Date:ClockDate,withinBranchHours:hours=>withinBranchHours(hours,new Date(now.value)),escapeHTML,validateCart,branchOpeningNotice,
        document:{getElementById:node,createElement:()=>({value:'',textContent:''}),querySelectorAll:()=>[]},
        Swal:{async fire(options){dialogs.push(options);return options?.showCancelButton?h.answer(options):{isConfirmed:true};}},
        db:{},doc:(_db,table,id)=>({path:table+'/'+id}),collection:(_db,table)=>({table}),query:ref=>ref,
        getDoc:ref=>read(ref,false),tkCustomerGetServerDoc:ref=>read(ref,true),
        getDocs:async ref=>{assert.equal(ref.table,'branches');h.locatorReads++;if(h.locatorWait)await h.locatorWait.promise;return {forEach:fn=>branches.forEach((branch,index)=>fn({id:'branch-'+index,data:()=>branch}))};},
        tkCustomerTransaction(){h.writes++;throw Error('Branch selection must not write an order.');},
        localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},sessionStorage:{getItem:()=>null,removeItem(){}},
        setInterval:()=>1,onSnapshot(){throw Error('No real subscriptions in branch-selection fixture.');},navigator:{onLine:true},console:{error(){}}});
    const h={window,now,reads,dialogs,screens,renders,cartUpdates,nodes,node,documents,failures,branches,cart,storage,
        mapRemovals:0,closedItems:0,closedCheckout:0,statusSubscriptions:0,locatorReads:0,writes:0,answer:async()=>({isConfirmed:true})};
    vm.runInContext(gateCode+selection,context);
    return h;
}
function assertKept(h) {
    assert.equal(h.window.cart,h.cart);assert.equal(h.window.cart.length,1);assert.equal(h.window.customerSelectedBranch,'Cabantian');assert.equal(h.window.customerCartBranch,'Cabantian');
    assert.equal(h.node('selectedBranch').value,'Cabantian');assert.equal(h.node('headerMenuBranchText').textContent,'Cabantian');assert.equal(h.node('native-lat').value,'7');assert.equal(h.node('native-lng').value,'125');
    assert.equal(h.window.currentDeliveryFee,100);assert.equal(h.window.customerSelectedCategory,'Takoyaki');assert.equal(h.node('searchInput').value,'keep search');
    assert.equal(h.mapRemovals,0);assert.equal(h.closedItems,0);assert.equal(h.closedCheckout,0);assert.equal(h.renders.length,0);assert.equal(h.statusSubscriptions,0);assert.deepEqual(h.screens,[]);assert.equal(h.writes,0);
    assert.equal(h.storage.get('takodeal_customer_cart'),JSON.stringify(h.cart));assert.equal(h.storage.get('tk_customer_cart_branch'),'Cabantian');
}

test('fresh branch confirmation uses actual status/policy gate and real Philippine hours',async()=>{
    const h=harness();assert.equal(await h.window.confirmCustomerBranchAvailable('Maa'),true);
    assert.deepEqual(h.reads,[{path:'settings/status_Maa',server:true},{path:'offline_policy/Maa',server:true}]);
    h.now.value=+new Date('2026-10-09T13:00:00Z');assert.equal(await h.window.confirmCustomerBranchAvailable('Maa'),false);
    assert.equal(h.reads.length,2);assertKept(h);
});
test('a refreshed branch map closing or removing the branch during the server check invalidates the captured availability',async()=>{
    for(const change of ['closed','removed']){
        const h=harness();h.statusWait=deferred();const pending=h.window.confirmCustomerBranchAvailable('Maa');assert.equal(h.reads.length,1);
        const refreshed=new Map(h.window.customerBranchData);
        if(change==='closed')refreshed.set('Maa',{name:'Maa',operatingHours:'1:00 PM - 9:00 PM'});else refreshed.delete('Maa');
        h.window.customerBranchData=refreshed;h.statusWait.resolve();assert.equal(await pending,false);assertKept(h);
        assert.deepEqual(h.reads,[{path:'settings/status_Maa',server:true},{path:'offline_policy/Maa',server:true}]);
    }
});
test('paused, closed and unknown branches cannot change the branch or cart through direct selection',async()=>{
    for(const branch of ['Maa','Closed','Unknown']){
        const h=harness();if(branch==='Maa')h.documents.set('settings/status_Maa',{mobileOrdersActive:false});
        assert.equal(await h.window.selectBranchAndEnter(branch),false);assertKept(h);assert.equal(h.window.customerBranchSelecting,false);
        assert.equal(h.dialogs.some(dialog=>dialog?.showCancelButton),false);assert.equal(h.dialogs[0].title,'Orders unavailable');assert.equal(h.locatorReads,1);
    }
});
test('missing status and refused fresh status/policy reads hold selection without clearing the cart',async()=>{
    for(const unavailable of ['missing-status','settings/status_Maa','offline_policy/Maa']){
        const h=harness();if(unavailable==='missing-status')h.documents.delete('settings/status_Maa');else h.failures.add(unavailable);
        assert.equal(await h.window.selectBranchAndEnter('Maa'),false);assertKept(h);assert.equal(h.locatorReads,1);
    }
});
test('required cashier lease is enforced for missing, expired, future or refused lease and can reopen on a fresh check',async()=>{
    for(const mode of ['missing','expired','future','refused']){
        const h=harness();h.documents.set('offline_policy/Maa',{requireCashierForCustomerOrders:true});
        if(mode==='expired')h.documents.set('cashier_leases/Maa',leaseAt(h.now.value-180000));
        if(mode==='future')h.documents.set('cashier_leases/Maa',leaseAt(h.now.value+30001));
        if(mode==='refused')h.failures.add('cashier_leases/Maa');
        assert.equal(await h.window.confirmCustomerBranchAvailable('Maa'),false);assertKept(h);
        h.failures.delete('cashier_leases/Maa');h.documents.set('cashier_leases/Maa',leaseAt(h.now.value-5000));
        assert.equal(await h.window.confirmCustomerBranchAvailable('Maa'),true);assert.equal(h.reads.filter(read=>read.path==='cashier_leases/Maa').length,2);
        assertKept(h);
    }
});
test('declining the cross-branch cart confirmation retains cart, selected branch and delivery draft',async()=>{
    const h=harness();h.answer=async()=>({isConfirmed:false});assert.equal(await h.window.selectBranchAndEnter('Maa'),false);
    assertKept(h);assert.equal(h.dialogs.length,1);assert.equal(h.dialogs[0].showCancelButton,true);assert.equal(h.locatorReads,0);assert.equal(h.window.customerBranchSelecting,false);
});
test('a branch paused while the cart confirmation is open is checked again before clearing anything',async()=>{
    const h=harness(),answer=deferred();h.answer=()=>answer.promise;
    const pending=h.window.selectBranchAndEnter('Maa');await new Promise(setImmediate);assert.equal(h.dialogs[0].showCancelButton,true);assertKept(h);
    h.documents.set('settings/status_Maa',{mobileOrdersActive:false});answer.resolve({isConfirmed:true});assert.equal(await pending,false);
    assertKept(h);assert.equal(h.dialogs.at(-1).title,'Orders unavailable');assert.equal(h.reads.filter(read=>read.path==='settings/status_Maa').length,3);assert.equal(h.locatorReads,1);
});
test('closing time during the cart confirmation is checked again using the real hours helper',async()=>{
    const h=harness();h.answer=async()=>{h.now.value=+new Date('2026-10-09T13:00:00Z');return {isConfirmed:true};};
    assert.equal(await h.window.selectBranchAndEnter('Maa'),false);assertKept(h);assert.equal(h.dialogs.at(-1).title,'Orders unavailable');
});
test('a cashier lease expiring during cart confirmation cannot clear the previous branch cart',async()=>{
    const h=harness();h.documents.set('offline_policy/Maa',{requireCashierForCustomerOrders:true});h.documents.set('cashier_leases/Maa',leaseAt(h.now.value-5000));
    h.answer=async()=>{h.now.value+=180000;return {isConfirmed:true};};
    assert.equal(await h.window.selectBranchAndEnter('Maa'),false);assertKept(h);assert.equal(h.dialogs.at(-1).title,'Orders unavailable');
});
test('blocked selection awaits locator refresh and releases its lock afterward',async()=>{
    const h=harness();h.documents.set('settings/status_Maa',{mobileOrdersActive:false});h.locatorWait=deferred();let finished=false;
    const pending=h.window.selectBranchAndEnter('Maa').then(value=>{finished=true;return value;});await new Promise(setImmediate);
    assert.equal(h.locatorReads,1);assert.equal(finished,false);assert.equal(h.window.customerBranchSelecting,true);assertKept(h);
    h.locatorWait.resolve();assert.equal(await pending,false);assert.equal(finished,true);assert.equal(h.window.customerBranchSelecting,false);assertKept(h);
});
test('confirmed available branch clears a cross-branch cart only after two server checks then enters the menu once',async()=>{
    const h=harness();assert.equal(await h.window.selectBranchAndEnter('Maa'),true);
    assert.equal(h.reads.filter(read=>read.path==='settings/status_Maa'&&read.server).length,2);assert.equal(h.dialogs.length,1);assert.equal(h.window.cart.length,0);assert.notEqual(h.window.cart,h.cart);
    assert.equal(h.window.customerSelectedBranch,'Maa');assert.equal(h.window.customerCartBranch,'Maa');assert.equal(h.node('selectedBranch').value,'Maa');assert.equal(h.node('headerMenuBranchText').textContent,'Maa');
    assert.deepEqual(h.renders,['Maa']);assert.deepEqual(h.screens,['orderingScreen']);assert.equal(h.statusSubscriptions,1);assert.equal(h.mapRemovals,1);assert.equal(h.window.currentDeliveryFee,0);assert.equal(h.writes,0);
});
test('double taps cannot run overlapping selection, duplicate prompts or clear a cart twice',async()=>{
    const h=harness();h.statusWait=deferred();const first=h.window.selectBranchAndEnter('Maa');
    assert.equal(await h.window.selectBranchAndEnter('Closed'),false);assert.equal(await h.window.selectBranchAndEnter('Maa'),false);assert.equal(h.reads.length,1);assertKept(h);
    h.statusWait.resolve();assert.equal(await first,true);assert.equal(h.dialogs.filter(dialog=>dialog?.showCancelButton).length,1);assert.deepEqual(h.renders,['Maa']);assert.deepEqual(h.screens,['orderingScreen']);assert.equal(h.window.customerBranchSelecting,false);
});
test('selecting the same available branch keeps its existing cart without a cross-branch confirmation',async()=>{
    const h=harness();assert.equal(await h.window.selectBranchAndEnter('Cabantian'),true);assert.equal(h.window.cart,h.cart);assert.equal(h.dialogs.length,0);assert.equal(h.mapRemovals,0);assert.equal(h.writes,0);
    assert.deepEqual(h.screens,['orderingScreen']);assert.equal(h.reads.filter(read=>read.path==='settings/status_Cabantian').length,1);
});
test('a failed menu renderer releases the selection lock and does not enter the ordering screen',async()=>{
    const h=harness();h.window.renderMenuForBranch=async()=>{throw Error('Mock menu unavailable');};
    await assert.rejects(h.window.selectBranchAndEnter('Cabantian'),/menu unavailable/);assert.equal(h.window.customerBranchSelecting,false);assert.deepEqual(h.screens,[]);assert.equal(h.window.cart,h.cart);assert.equal(h.writes,0);
});
test('actual locator cards disable closed/paused/lease-blocked branches without click handlers and allow reopened branches',async()=>{
    const h=harness();h.documents.set('settings/status_Cabantian',{mobileOrdersActive:false});h.documents.set('offline_policy/Maa',{requireCashierForCustomerOrders:true});
    await h.window.loadBranchLocator();const blocked=h.node('branchCardsGrid').innerHTML;
    const cards=blocked.match(/<article[\s\S]*?<\/article>/g)||[];assert.equal(cards.length,3);
    for(const card of cards){assert.match(card,/<button[^>]+disabled aria-disabled="true"[^>]*>Unavailable<\/button>/);assert.doesNotMatch(card,/onclick="window.selectBranchAndEnter/);}
    assert.doesNotMatch(blocked,/>Main Office</);assert.equal(h.node('branchCountText').textContent,'3 branches · 0 accepting orders');assert.equal(h.reads.every(read=>read.server),true);assert.equal(h.writes,0);
    h.documents.set('cashier_leases/Maa',leaseAt(h.now.value-5000));await h.window.loadBranchLocator();
    const reopened=h.node('branchCardsGrid').innerHTML.match(/<article[\s\S]*?<\/article>/g)||[];assert.match(reopened[0],/<h2>Maa<\/h2>/);assert.match(reopened[0],/onclick="window.selectBranchAndEnter/);assert.match(reopened[0],/>View menu →<\/button>/);
    assert.equal(h.node('branchCountText').textContent,'3 branches · 1 accepting orders');assert.equal(h.window.customerBranchesLoading,false);assertKept(h);
});

test('an opening-soon branch with active ordering status cannot be selected or clear an existing cart',async()=>{
    const h=harness();h.branches[0].customerSoonToOpen=true;
    assert.equal(await h.window.confirmCustomerBranchAvailable('Maa'),false);assert.equal(h.reads.length,0);
    assert.equal(await h.window.selectBranchAndEnter('Maa'),false);assertKept(h);
    assert.equal(h.dialogs.some(dialog=>dialog?.showCancelButton),false);assert.equal(h.dialogs[0].title,'Orders unavailable');assert.equal(h.locatorReads,1);
});
test('the actual locator disables an active upcoming branch and escapes its custom watermark',async()=>{
    const h=harness();h.branches[0].customerSoonToOpen=true;h.branches[0].customerOpeningLabel='Opening <sample> & "soon"';
    await h.window.loadBranchLocator();const cards=h.node('branchCardsGrid').innerHTML.match(/<article[\s\S]*?<\/article>/g)||[];
    const maa=cards.find(card=>card.includes('<h2>Maa</h2>'));
    assert.ok(maa);assert.match(maa,/customer-opening-watermark[^>]*>Opening &lt;sample&gt; &amp; &quot;soon&quot;<\/span>/);
    assert.match(maa,/<button[^>]+disabled aria-disabled="true"[^>]*>Unavailable<\/button>/);assert.doesNotMatch(maa,/onclick="window.selectBranchAndEnter/);assert.doesNotMatch(maa,/<sample>/);
    assert.equal(h.node('branchCountText').textContent,'3 branches · 1 accepting orders');assertKept(h);
});
test('a branch marked upcoming while the fresh status check waits invalidates captured availability',async()=>{
    const h=harness();h.statusWait=deferred();const pending=h.window.confirmCustomerBranchAvailable('Maa');assert.equal(h.reads.length,1);
    const refreshed=new Map(h.window.customerBranchData);refreshed.set('Maa',{...refreshed.get('Maa'),customerSoonToOpen:true});h.window.customerBranchData=refreshed;
    h.statusWait.resolve();assert.equal(await pending,false);assertKept(h);
});
test('marking a branch upcoming during cart confirmation keeps the original cart and delivery draft',async()=>{
    const h=harness();h.answer=async()=>{h.branches[0].customerSoonToOpen=true;return {isConfirmed:true};};
    assert.equal(await h.window.selectBranchAndEnter('Maa'),false);assertKept(h);
    assert.equal(h.dialogs.filter(dialog=>dialog?.showCancelButton).length,1);assert.equal(h.dialogs.at(-1).title,'Orders unavailable');
    assert.equal(h.window.customerBranchSelecting,false);
});
test('clearing the saved upcoming flag and refreshing restores selection only after availability confirmation',async()=>{
    const h=harness();h.branches[0].customerSoonToOpen=true;await h.window.loadBranchLocator();assert.equal(await h.window.confirmCustomerBranchAvailable('Maa'),false);
    h.branches[0].customerSoonToOpen=false;await h.window.loadBranchLocator();const card=(h.node('branchCardsGrid').innerHTML.match(/<article[\s\S]*?<\/article>/g)||[]).find(value=>value.includes('<h2>Maa</h2>'));
    assert.match(card,/onclick="window.selectBranchAndEnter/);assert.doesNotMatch(card,/customer-opening-watermark/);assert.equal(await h.window.confirmCustomerBranchAvailable('Maa'),true);assertKept(h);
});
