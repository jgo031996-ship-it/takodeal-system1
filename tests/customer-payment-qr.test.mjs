import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../Customer/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../Customer/customer-theme.css',import.meta.url),'utf8');
const start=html.indexOf('window.updateNativeUI = function()');
const end=html.indexOf('window.initiateCheckout = async function()',start);
assert.ok(start>=0 && end>start,'Exercise the actual checkout display function.');

function fixture() {
    const nodes=new Map();
    const node=id=>{
        if (!nodes.has(id)) {
            const tag=html.match(new RegExp('<[^>]+\\bid="'+id+'"[^>]*>'))?.[0];
            assert.ok(tag,'Checkout element '+id+' exists in the real markup.');
            const classes=new Set((tag.match(/\bclass="([^"]*)"/)?.[1] || '').split(/\s+/).filter(Boolean));
            const style={display:'',removeProperty(name){const old=this[name];this[name]='';return old;}};
            nodes.set(id,{id,value:'',innerHTML:'',innerText:'',textContent:'',style,
                classList:{contains:entry=>classes.has(entry),add:entry=>classes.add(entry),remove:entry=>classes.delete(entry),
                    toggle(entry,force){const add=force ?? !classes.has(entry);if(add)classes.add(entry);else classes.delete(entry);return add;}}});
        }
        return nodes.get(id);
    };
    node('native-type').value='Takeout';node('native-payment').value='Cash';node('selectedBranch').value='Maa';
    node('native-ref').value='Existing payment reference';
    const cart=[{menuId:'sample-a',quantity:1,lineTotalFinal:120},{menuId:'sample-b',quantity:2,lineTotalFinal:75}];
    const window={cart,currentDeliveryFee:35};
    const context=vm.createContext({window,document:{getElementById:node}});
    vm.runInContext(html.slice(start,end),context);
    // Match the real theme's !important hidden rule, which defeats inline block.
    const visible=id=>!node(id).classList.contains('hidden') && node(id).style.display!=='none';
    return {node,window,cart,visible,update:window.updateNativeUI};
}

test('online payment reveals the existing QR and reference section despite the theme hidden rule',()=>{
    assert.match(css,/\.hidden\s*\{\s*display\s*:\s*none\s*!important\s*;/);
    const h=fixture();assert.equal(h.visible('native-online-div'),false);
    h.node('native-payment').value='Online';h.update();
    assert.equal(h.visible('native-online-div'),true);assert.equal(h.visible('native-cash-div'),false);
    assert.equal(h.visible('native-pickup-note'),false);assert.equal(h.visible('native-cod-div'),false);
    assert.equal(h.node('checkoutModalTotal').innerText,'₱195.00');
    assert.equal(h.node('native-ref').value,'Existing payment reference');
    assert.equal(h.node('native-branch-contact').innerText,'0956 617 6979');
});

test('switching repeatedly between online and cash hides the QR and retains the entered reference',()=>{
    const h=fixture();
    for (let iteration=0;iteration<3;iteration++) {
        h.node('native-payment').value='Online';h.update();assert.equal(h.visible('native-online-div'),true);
        h.node('native-payment').value='Cash';h.update();assert.equal(h.visible('native-online-div'),false);
        assert.equal(h.visible('native-cash-div'),true);assert.equal(h.visible('native-pickup-note'),true);assert.equal(h.visible('native-cod-div'),false);
    }
    assert.equal(h.node('native-ref').value,'Existing payment reference');
    assert.deepEqual(h.window.cart,[{menuId:'sample-a',quantity:1,lineTotalFinal:120},{menuId:'sample-b',quantity:2,lineTotalFinal:75}]);
});

test('pickup, delivery and advance sections follow both checkout selections with unchanged totals',()=>{
    const h=fixture();
    for (const type of ['Takeout','Delivery','Advance Takeout','Advance Delivery']) {
        for (const payment of ['Cash','Online']) {
            h.node('native-type').value=type;h.node('native-payment').value=payment;h.update();
            const delivery=type.includes('Delivery'),advance=type.includes('Advance'),cash=payment==='Cash';
            assert.equal(h.visible('native-time-div'),advance,type+' '+payment+' time');
            assert.equal(h.visible('native-delivery-div'),delivery,type+' '+payment+' location');
            assert.equal(h.visible('native-online-div'),!cash,type+' '+payment+' QR');
            assert.equal(h.visible('native-cash-div'),cash,type+' '+payment+' cash');
            assert.equal(h.visible('native-cod-div'),delivery && cash,type+' '+payment+' change');
            assert.equal(h.visible('native-pickup-note'),!delivery && cash,type+' '+payment+' pickup');
            assert.equal(h.visible('deliveryFeeRow'),delivery,type+' '+payment+' fee');
            assert.equal(h.node('checkoutModalTotal').innerText,delivery?'₱230.00':'₱195.00');
            if (delivery) assert.match(h.node('deliveryFeeRow').innerHTML,/₱35\.00/);
        }
    }
    assert.equal(h.window.currentDeliveryFee,35);assert.equal(h.window.cart,h.cart);
});

test('visibility changes clear old inline display state instead of competing with hidden classes',()=>{
    const h=fixture();
    for (const id of ['native-online-div','native-cash-div','native-time-div','native-delivery-div','native-pickup-note','native-cod-div']) h.node(id).style.display='none';
    h.node('native-type').value='Advance Delivery';h.node('native-payment').value='Online';h.update();
    assert.equal(h.visible('native-online-div'),true);assert.equal(h.visible('native-time-div'),true);assert.equal(h.visible('native-delivery-div'),true);
    assert.equal(h.visible('native-cash-div'),false);assert.equal(h.visible('native-cod-div'),false);
    for (const id of ['native-online-div','native-cash-div','native-time-div','native-delivery-div','native-pickup-note','native-cod-div']) assert.equal(h.node(id).style.display,'');
});

test('the payment markup still uses the existing local JPEG and original payment method values',()=>{
    const online=html.match(/<div id="native-online-div"[\s\S]*?<\/div>/)?.[0];assert.ok(online);
    assert.match(online,/<img\b[^>]*src="QR\.jpg"[^>]*alt="TAKODEÁL InstaPay payment QR"/);
    const jpeg=readFileSync(new URL('../Customer/QR.jpg',import.meta.url));
    assert.equal(jpeg.readUInt16BE(0),0xffd8);assert.equal(jpeg.readUInt16BE(jpeg.length-2),0xffd9);
    const payment=html.match(/<select id="native-payment"[\s\S]*?<\/select>/)?.[0];assert.ok(payment);
    assert.deepEqual([...payment.matchAll(/<option value="([^"]+)"/g)].map(match=>match[1]),['Cash','Online']);
});
