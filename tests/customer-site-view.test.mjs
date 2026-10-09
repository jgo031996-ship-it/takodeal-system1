import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {renderCustomerSiteProfile} from '../Customer/customer-site-view.js';
import {CUSTOMER_SITE_PROFILE_DOC} from '../Customer/customer-site-settings.js';

function page() {
    const nodes=new Map(['customerAboutTitle','customerAboutMeta','customerAboutText'].map(id=>[id,{textContent:'',hidden:false}]));
    const footers=[{textContent:''},{textContent:''},{textContent:''}];
    const document={getElementById:id=>nodes.get(id),querySelectorAll:selector=>{assert.equal(selector,'[data-customer-site-footer]');return footers;}};
    return {document,nodes,footers};
}
test('About TAKODEAL and every customer footer share the saved brand, city and year',()=>{
    const p=page();renderCustomerSiteProfile(p.document,{businessName:'TAKODEÁL',location:'Davao City',sinceYear:'2023',aboutText:'Your ideal takoyaki.\nMade for sharing.'});
    assert.equal(p.nodes.get('customerAboutTitle').textContent,'About TAKODEÁL');
    assert.equal(p.nodes.get('customerAboutMeta').textContent,'TAKODEÁL · Davao City · Since 2023');
    assert.ok(p.footers.every(node=>node.textContent==='TAKODEÁL · Davao City · Since 2023'));
    assert.equal(p.nodes.get('customerAboutText').hidden,false);
    assert.equal(p.nodes.get('customerAboutText').textContent,'Your ideal takoyaki.\nMade for sharing.');
});
test('public content is inserted as text and missing description stays hidden',()=>{
    const p=page();renderCustomerSiteProfile(p.document,{businessName:'<img onerror=alert(1)>',location:'<script>City</script>',sinceYear:2023,aboutText:'<b>Plain text only</b>'});
    assert.equal(p.nodes.get('customerAboutText').textContent,'<b>Plain text only</b>');
    assert.equal(p.nodes.get('customerAboutTitle').textContent,'About <img onerror=alert(1)>');
    renderCustomerSiteProfile(p.document,{});
    assert.equal(p.nodes.get('customerAboutText').hidden,true);
    assert.ok(p.footers.every(node=>node.textContent==='TAKODEÁL · Davao City · Since 2023'));
});
function loader() {
    const html=readFileSync(new URL('../Customer/index.html',import.meta.url),'utf8');
    const start=html.indexOf('window.loadCustomerSiteProfile = async function'),end=html.indexOf('window.loadBranchLocator = async function',start);
    const p=page(),window={},reads=[],pending=[];
    const context=vm.createContext({window,document:p.document,CUSTOMER_SITE_PROFILE_DOC,renderCustomerSiteProfile,db:{},doc:(_db,table,id)=>({table,id}),getDoc:ref=>{reads.push(ref);return new Promise((resolve,reject)=>pending.push({resolve,reject}));}});
    vm.runInContext(html.slice(start,end),context);
    return {...p,window,reads,pending};
}
test('actual public profile loader coalesces reads and refreshes the single public settings record',async()=>{
    const p=loader();const first=p.window.loadCustomerSiteProfile(),second=p.window.loadCustomerSiteProfile();
    assert.equal(p.reads.length,1);assert.deepEqual({...p.reads[0]},{table:'settings',id:'customer_site_profile'});
    p.pending[0].resolve({exists:()=>true,data:()=>({businessName:'TAKODEÁL',location:'Davao',sinceYear:2023,aboutText:'Sample story'})});await Promise.all([first,second]);
    assert.equal(p.window.customerSiteProfileLoading,null);assert.equal(p.nodes.get('customerAboutText').textContent,'Sample story');
    const refresh=p.window.loadCustomerSiteProfile();p.pending[1].resolve({exists:()=>true,data:()=>({location:'Davao City',sinceYear:2023})});await refresh;
    assert.equal(p.footers[0].textContent,'TAKODEÁL · Davao City · Since 2023');
});
test('failed reads use the default initially and preserve the last confirmed profile on a later failure',async()=>{
    const p=loader();let read=p.window.loadCustomerSiteProfile();p.pending[0].reject(Error('offline'));await read;
    assert.equal(p.footers[0].textContent,'TAKODEÁL · Davao City · Since 2023');
    read=p.window.loadCustomerSiteProfile();p.pending[1].resolve({exists:()=>true,data:()=>({location:'Saved city',sinceYear:2023,aboutText:'Saved story'})});await read;
    read=p.window.loadCustomerSiteProfile();p.pending[2].reject(Error('offline'));await read;
    assert.equal(p.footers[0].textContent,'TAKODEÁL · Saved city · Since 2023');
    assert.equal(p.nodes.get('customerAboutText').textContent,'Saved story');
});
