import test from 'node:test';
import assert from 'node:assert/strict';
import {renderOrderDetails,renderOrderHistoryCard} from '../Customer/customer-order-details.js';

const visible=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const rendered=order=>[renderOrderDetails(order),renderOrderHistoryCard(order)];
const savedOrder=()=>({orderCode:'SYNTHETIC-ORDER',branch:'Maa',orderType:'Delivery',preferredTime:'Nov 8, 2026 · 12:30 PM',
  deliveryAddress:'Fictional building, test street',paymentMode:'Cash',deliveryFee:50,totalAmount:350,status:'preparing',
  timestamp:{toDate:()=>new Date('2026-11-08T04:30:00Z')},items:[
    {name:'Saved Latte',quantity:2,variantName:'Large',lineTotalFinal:180,addons:{Shot:{qty:1,price:20},Pearls:{name:'Pearls',qty:2,price:10},Skipped:{qty:0}},notes:'Less ice, please'},
    {name:'Saved Takoyaki',quantity:1,variantName:'Standard',lineTotalFinal:120,addons:{}}]});

test('saved item quantities, exact line totals, variants, object addons and notes appear in the receipt',()=>{
  const html=renderOrderDetails(savedOrder()),text=visible(html);
  assert.match(text,/2 × Saved Latte ₱180\.00/);assert.match(text,/1 × Saved Takoyaki ₱120\.00/);
  assert.match(text,/Option: Large/);assert.doesNotMatch(text,/Option: Standard/);
  assert.match(text,/Options per item: 1 × Shot, 2 × Pearls/);assert.doesNotMatch(text,/Skipped/);
  assert.match(text,/Note: Less ice, please/);assert.match(html,/aria-label="Order summary"/);
});

test('saved total already includes delivery fee and is not recalculated or charged twice',()=>{
  for(const html of rendered(savedOrder())){
    const text=visible(html);assert.match(text,/Delivery fee \(included\) ₱50\.00/);assert.match(text,/Order total ₱350\.00/);
    assert.doesNotMatch(text,/₱400\.00/);
  }
  const inconsistent=savedOrder();inconsistent.totalAmount=999;
  assert.match(visible(renderOrderDetails(inconsistent)),/Order total ₱999\.00/,'the saved total remains the displayed source even if item arithmetic differs');
});

test('only saved lineTotalFinal and totalAmount may supply prices; unit price or item sums cannot fill missing totals',()=>{
  const order={branch:'Maa',items:[{name:'No saved line total',quantity:3,price:99,unitPrice:88,amount:77,total:66,lineTotal:55},
    {name:'Saved line total',quantity:1,lineTotalFinal:125}],deliveryFee:50};
  for(const html of rendered(order)){
    const text=visible(html);assert.match(text,/3 × No saved line total Not available/);assert.match(text,/Saved line total ₱125\.00/);
    assert.match(text,/Order total Not available/);assert.doesNotMatch(text,/₱297\.00|₱264\.00|₱77\.00|₱66\.00|₱55\.00|₱175\.00/);
  }
});

test('missing, malformed, negative and nonfinite monetary values show unavailable rather than a fabricated zero',()=>{
  for(const value of [undefined,null,'','   ','not recorded','12 pesos','₱120','1,200','Infinity','NaN',NaN,Infinity,-Infinity,-1,'-1',false,true,{},[]]){
    const order={branch:'Maa',orderType:'Delivery',deliveryFee:value,totalAmount:value,items:[{name:'Unknown amount',quantity:1,lineTotalFinal:value}]};
    for(const html of rendered(order)){
      const text=visible(html);assert.match(text,/Unknown amount Not available/);assert.match(text,/Order total Not available/);
      assert.doesNotMatch(text,/₱0\.00|₱NaN|₱Infinity/);assert.doesNotMatch(text,/Delivery fee \(included\)/);
    }
  }
});

test('an explicitly saved zero is distinct from missing money, and complete numeric strings remain readable',()=>{
  for(const value of [0,'0',' 0.00 ']){
    const text=visible(renderOrderDetails({totalAmount:value,items:[{name:'Recorded free item',quantity:1,lineTotalFinal:value}]}));
    assert.match(text,/Recorded free item ₱0\.00/);assert.match(text,/Order total ₱0\.00/);
  }
  const text=visible(renderOrderDetails({totalAmount:' 1200.50 ',items:[{name:'Recorded amount',quantity:'2',lineTotalFinal:'1200.5'}]}));
  assert.match(text,/2 × Recorded amount ₱1,200\.50/);assert.match(text,/Order total ₱1,200\.50/);
});

test('unknown or invalid quantities display a question mark, while exact legacy qty and itemName remain supported',()=>{
  for(const value of [undefined,null,'','unknown','2spoof',0,-1,NaN,Infinity,false,{},[]]){
    const text=visible(renderOrderDetails({items:[{name:'Quantity unknown',quantity:value,lineTotalFinal:40}]}));
    assert.match(text,/\? × Quantity unknown ₱40\.00/);assert.doesNotMatch(text,/1 × Quantity unknown/);
  }
  const order={items:[{itemName:'Legacy saved item',qty:3,lineTotalFinal:120}]};
  for(const html of rendered(order))assert.match(visible(html),/3 × Legacy saved item/);
  assert.match(visible(renderOrderDetails({items:[{name:'Bad primary quantity',quantity:'broken',qty:9,lineTotalFinal:50}]})),/\? × Bad primary quantity/);
});

test('array addons show only named positive saved quantities, per item, without guessing array indices or costs',()=>{
  const html=renderOrderDetails({items:[{name:'Test drink',quantity:4,lineTotalFinal:200,addons:[
    {name:'Extra shot',qty:1,price:30},{name:'Pearls',qty:'2',price:99},{name:'Zero topping',qty:0},
    {name:'Negative topping',qty:-1},{name:'Broken topping',qty:'bad'},{qty:1},null,'not an addon']}]});
  const text=visible(html);assert.match(text,/Options per item: 1 × Extra shot, 2 × Pearls/);
  assert.doesNotMatch(text,/Zero topping|Negative topping|Broken topping|not an addon|1 × 5|4 × Extra shot|₱30\.00|₱99\.00/);
});

test('pickup metadata omits stale delivery address and fee; delivery metadata uses the saved route details',()=>{
  const pickup={...savedOrder(),orderType:'Advance Pickup'};
  for(const html of rendered(pickup)){
    const text=visible(html);assert.match(text,/Branch Maa/);assert.match(text,/Order type Advance Pickup/);assert.match(text,/Preferred time Nov 8, 2026/);assert.match(text,/Payment method Cash/);
    assert.doesNotMatch(text,/Delivery address|Fictional building|Delivery fee/);
  }
  const text=visible(renderOrderDetails(savedOrder()));assert.match(text,/Order type Delivery/);assert.match(text,/Delivery address Fictional building, test street/);
});

test('malicious saved display text is escaped in items, addon names, variants, notes and every visible order field',()=>{
  const attack='<img src=x onerror="OWNED"> & \'quoted\'';
  const order={...savedOrder(),orderCode:attack,branch:attack,orderType:'Delivery '+attack,preferredTime:attack,paymentMode:attack,deliveryAddress:attack,
    items:[{name:attack,quantity:1,lineTotalFinal:40,variantName:attack,notes:attack,addons:{[attack]:{qty:1},other:{name:attack,qty:2}}},
      {itemName:attack,qty:1,lineTotalFinal:20}]};
  for(const html of rendered(order)){
    assert.doesNotMatch(html,/<img|<script|<svg|\bonerror="OWNED"/i);assert.match(html,/&lt;img/);assert.match(html,/&amp;/);assert.match(html,/&quot;OWNED&quot;/);assert.match(html,/&#39;quoted&#39;/);
  }
});

test('amount and quantity payloads cannot inject markup and never become inferred money',()=>{
  const attack='<svg onload="OWNED">';
  for(const html of rendered({totalAmount:attack,deliveryFee:attack,orderType:'Delivery',items:[{name:'Saved item',quantity:attack,lineTotalFinal:attack}]})){
    const text=visible(html);assert.match(text,/\? × Saved item/);assert.match(text,/Order total Not available/);assert.doesNotMatch(html,/<svg|OWNED|₱0\.00/);
  }
});

test('explicit public fields exclude private contact, payment evidence, credentials and operational data',()=>{
  const order={...savedOrder(),customerEmail:'SECRET_CUSTOMER_EMAIL',contactNumber:'SECRET_PHONE',customerName:'SECRET_CUSTOMER_NAME',paymentReference:'SECRET_PAYMENT_REFERENCE',
    proofImageUrl:'SECRET_PAYMENT_PROOF',mapLink:'SECRET_MAP_LINK',changeFor:'SECRET_CHANGE',deliveryQuote:{token:'SECRET_ROUTE_TOKEN'},
    rider:{name:'SECRET_RIDER',pin:'SECRET_RIDER_PIN'},internalNotes:'SECRET_INTERNAL_NOTES',refundReason:'SECRET_REFUND_REASON',staffPin:'SECRET_STAFF_PIN',
    items:[{name:'Public item',quantity:1,lineTotalFinal:100,cost:123,recipe:[{name:'SECRET_RECIPE'}],privateNotes:'SECRET_ITEM_NOTES',stockDeductions:'SECRET_STOCK'}]};
  for(const html of rendered(order))assert.doesNotMatch(html,/SECRET_|recipe|stockDeductions|paymentReference|contactNumber|customerEmail/);
});

test('renderers do not inspect unused private fields or today’s pricing objects',()=>{
  const order=savedOrder();
  for(const field of ['customerEmail','contactNumber','paymentReference','proofImageUrl','deliveryQuote','mapLink','internalNotes','rider','staffPin'])Object.defineProperty(order,field,{get(){throw Error('Private field must not be read: '+field);}});
  for(const item of order.items)for(const field of ['price','unitPrice','cost','recipe','inventory','menuItem'])Object.defineProperty(item,field,{get(){throw Error('Current/private item data must not be read: '+field);}});
  for(const html of rendered(order))assert.match(html,/Saved Latte/);
});

test('history keeps the saved order code, status, total and details behind an accessible disclosure',()=>{
  const html=renderOrderHistoryCard(savedOrder()),text=visible(html);
  assert.match(text,/SYNTHETIC-ORDER/);assert.match(text,/2026/);assert.match(text,/Preparing/);assert.match(text,/₱350\.00/);
  assert.match(text,/2 × Saved Latte/);assert.match(html,/<details\b/);assert.match(html,/<summary>View order details<\/summary>/);assert.match(html,/Order summary/);
});

test('history recognizes only known own status keys and cannot print attacker or inherited object members',()=>{
  for(const status of ['<img onerror=bad>','unknown','constructor','toString','__proto__']){
    const html=renderOrderHistoryCard({...savedOrder(),status});assert.match(visible(html),/Status unavailable/);assert.doesNotMatch(html,/<img|native code|\[object Object\]/);
  }
});

test('old empty schemas, missing arrays, malformed item entries and broken timestamps have honest fallbacks',()=>{
  for(const order of [undefined,null,{}, {items:null}, {items:{}}, {items:[null,undefined,3,'bad',[]]}, {timestamp:{toDate(){throw Error('legacy time');}},totalAmount:'unknown'}]){
    for(const html of rendered(order)){
      const text=visible(html);assert.match(text,/Item details are not available for this order/);assert.match(text,/Order total Not available/);
      assert.doesNotMatch(text,/undefined|NaN|Infinity|₱0\.00|\[object Object\]/);
    }
  }
  assert.match(visible(renderOrderHistoryCard({timestamp:'not a timestamp'})),/Recent/);
});

test('rendering does not mutate stored order data, saved items or nested addons',()=>{
  const order=savedOrder(),before={...order,items:structuredClone(order.items)};
  rendered(order);assert.deepEqual(order,before);
});
