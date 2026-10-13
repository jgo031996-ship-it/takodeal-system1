import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {installCustomerApp,customerInstallContext} from '../Customer/customer-install.js';

function setup({ua='Mozilla Android Chrome',standalone=false,blockedStorage=false}={}){
    const nodes=new Map(),events=new Map(),saved=new Map(),copied=[],displayEvents=[];
    const node=id=>{if(!nodes.has(id))nodes.set(id,{id,hidden:false,disabled:false,textContent:'',attributes:{},value:'',children:[],setAttribute(name,value){this.attributes[name]=value;},append(child){this.children.push(child);},remove(){nodes.delete(id);},focus(){this.focused=true;},select(){this.selected=true;}});return nodes.get(id);};
    const slot=node('customerInstallSlot');Object.defineProperty(slot,'innerHTML',{set(html){for(const match of html.matchAll(/id="([^"]+)"/g))node(match[1]);for(const id of ['customerInstallOpen','customerInstallSteps','customerInstallLinkHelp'])node(id).hidden=true;}});
    const document={getElementById:id=>nodes.get(id)||null,createElement:()=>node('generated-'+nodes.size)};
    const window={navigator:{userAgent:ua,standalone,clipboard:{writeText:async value=>copied.push(value)}},location:{href:'https://takodeal-customer.vercel.app/?fbclid=track&code=private#order=secret'},matchMedia:()=>({matches:standalone,addEventListener:(_name,fn)=>displayEvents.push(fn)}),sessionStorage:{getItem:key=>{if(blockedStorage)throw Error('blocked');return saved.get(key);},setItem:(key,value)=>{if(blockedStorage)throw Error('blocked');saved.set(key,value);}},addEventListener:(name,fn)=>events.set(name,fn)};
    const app=installCustomerApp(window,document);
    const prompt=(outcome='dismissed')=>{let calls=0,prevented=false;const event={preventDefault(){prevented=true;},prompt(){calls++;return Promise.resolve();},userChoice:Promise.resolve({outcome})};return {event,get calls(){return calls;},get prevented(){return prevented;}};};
    return {window,document,node,nodes,saved,copied,app,prompt,emit:(name,event)=>events.get(name)?.(event),displayEvents};
}
test('link entry shows a suggestion and a browser install prompt runs only on the customer click, once',async()=>{
    const h=setup(),p=h.prompt('accepted');assert.equal(h.node('customerInstallCard').hidden,false);
    h.emit('beforeinstallprompt',p.event);assert.equal(p.prevented,true);assert.equal(p.calls,0);assert.equal(h.node('customerInstallAction').textContent,'Install TAKODEÁL');
    const click=h.node('customerInstallAction').onclick();assert.equal(p.calls,1);await h.node('customerInstallAction').onclick();await click;assert.equal(p.calls,1);
    await h.node('customerInstallAction').onclick();assert.equal(p.calls,1);assert.equal(h.node('customerInstallSteps').hidden,false);
});
test('a dismissed or failed browser prompt allows ordering and can use a newly offered prompt',async()=>{
    const h=setup(),p=h.prompt();h.emit('beforeinstallprompt',p.event);await h.node('customerInstallAction').onclick();assert.match(h.node('customerInstallStatus').textContent,/keep ordering/);
    const next=h.prompt();next.event.prompt=()=>{throw Error('gesture expired');};h.emit('beforeinstallprompt',next.event);await h.node('customerInstallAction').onclick();assert.equal(h.node('customerInstallAction').disabled,false);assert.equal(h.node('customerInstallSteps').hidden,false);
});
test('Maybe later stays dismissed when native eligibility arrives, with a working reopen control',()=>{
    const h=setup();h.node('customerInstallLater').onclick();const p=h.prompt();h.emit('beforeinstallprompt',p.event);
    assert.equal(h.node('customerInstallCard').hidden,true);assert.equal(h.node('customerInstallOpen').hidden,false);assert.equal(p.calls,0);
    h.app.show();assert.equal(h.node('customerInstallCard').hidden,false);assert.equal(h.saved.get('tk_customer_install_later'),'1');
});
test('iPhone and iPad receive Home Screen instructions instead of a false automatic installation',async()=>{
    for(const ua of ['Mozilla iPhone Safari','Mozilla Macintosh Safari']){const h=setup({ua});if(ua.includes('Macintosh')){h.window.navigator.maxTouchPoints=5;assert.equal(customerInstallContext(h.window).ios,true);continue;}
        const p=h.prompt();h.emit('beforeinstallprompt',p.event);await h.node('customerInstallAction').onclick();assert.equal(p.prevented,false);assert.equal(p.calls,0);assert.equal(h.node('customerInstallAction').textContent,'Add to Home Screen');assert.ok(h.node('customerInstallInstructions').children.some(n=>n.textContent.includes('Share')));
    }
});
test('Messenger guide copies only the public ordering URL and handles unavailable clipboard access',async()=>{
    const h=setup({ua:'Mozilla iPhone FBAN/Messenger FBAV/500'});await h.node('customerInstallAction').onclick();assert.equal(h.node('customerInstallLinkHelp').hidden,false);assert.match(h.node('customerInstallInstructions').children[0].textContent,/Messenger/);
    await h.node('customerInstallCopy').onclick();assert.deepEqual(h.copied,['https://takodeal-customer.vercel.app/']);
    h.window.navigator.clipboard={writeText:async()=>{throw Error('denied');}};await h.node('customerInstallCopy').onclick();assert.equal(h.node('customerInstallLink').selected,true);
});
test('installed apps hide suggestions and blocked storage does not break the ordering page',()=>{
    const already=setup({standalone:true});assert.equal(already.node('customerInstallCard').hidden,true);assert.equal(already.node('customerInstallOpen').hidden,true);
    const h=setup({blockedStorage:true});h.node('customerInstallLater').onclick();h.app.show();h.emit('appinstalled');assert.equal(h.node('customerInstallCard').hidden,true);assert.equal(h.node('customerInstallOpen').hidden,true);
    assert.equal(installCustomerApp(h.window,h.document),null);
});
test('manifest declares real PNG icon dimensions and the installation identity starts at the ordering page',()=>{
    const manifest=JSON.parse(readFileSync(new URL('../Customer/manifest.json',import.meta.url),'utf8'));
    assert.equal(manifest.id,'/');assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'./');assert.equal(manifest.start_url,'.');
    for(const size of [192,512]){const icon=manifest.icons.find(i=>i.sizes===size+'x'+size);assert.equal(icon.type,'image/png');assert.equal(icon.purpose,'any');const png=readFileSync(new URL('../Customer/'+icon.src,import.meta.url));assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);}
});
function worker({fail=false}={}){const events=new Map(),requests=[];const context={self:{location:{origin:'https://takodeal-customer.vercel.app'},addEventListener:(name,fn)=>events.set(name,fn),skipWaiting:async()=>{},clients:{claim:async()=>{}}},URL,Response,fetch:async request=>{requests.push(request);if(fail)throw Error('offline');return new Response('live branch availability');}};vm.runInNewContext(readFileSync(new URL('../Customer/sw.js',import.meta.url),'utf8'),context);return {events,requests};}
test('the install worker does not intercept order submissions, API calls or app resources',()=>{
    const h=worker();for(const request of [{method:'POST',mode:'navigate',url:'https://takodeal-customer.vercel.app/'},{method:'GET',mode:'cors',url:'https://takodeal-customer.vercel.app/api/orders'},{method:'GET',mode:'navigate',url:'https://other.example/'}])h.events.get('fetch')({request,respondWith(){assert.fail('Unrelated request intercepted');}});assert.equal(h.requests.length,0);
});
test('live navigation stays fresh and an offline navigation shows reconnection help without cached orders',async()=>{
    for(const fail of [false,true]){const h=worker({fail});let result;h.events.get('fetch')({request:{method:'GET',mode:'navigate',url:'https://takodeal-customer.vercel.app/'},respondWith:promise=>{result=promise;}});const response=await result;const text=await response.text();assert.equal(h.requests.length,1);assert.equal(response.status,fail?503:200);assert.match(text,fail?/No order was submitted/:/live branch availability/);}
});
