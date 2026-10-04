// Run against the real cashier HTML with fixture data and no Firebase access.
// CASHIER_PLAYWRIGHT_PATH and CASHIER_CHROME_BIN allow existing local installs.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CASHIER_PLAYWRIGHT_PATH || 'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const main=readFileSync(path.join(root,'Takodeal-POS/main.js'),'utf8');
const renderer=main.slice(main.indexOf('window.renderOrderAndPaymentUI = function() {'),main.indexOf('// --- UPGRADED CART & VARIANT LOGIC ---'));
const expense=main.slice(main.indexOf('window.expenseCart = [];'),main.indexOf('// Mobile-friendly custom search dropdown'));
const origin='http://cashier.test';
let html=readFileSync(path.join(root,'Takodeal-POS/index.html'),'utf8')
  .replace('<head>','<head><base href="/Takodeal-POS/">')
  .replace(/<script[^>]*src="https[^>]*><\/script>/g,'')
  .replace(/<script type="module" src="main.js[^>]*><\/script>/g,'')
  .replace("if ('serviceWorker' in navigator)",'if (false)');
html=html.replace('</body>',`<script type="module">
import {renderPayments} from '/Takodeal-POS/cashier-payments.js';
window.Swal={fire:async()=>({isConfirmed:false})};window.sessionUser={branch:'Cabantian',cashierName:'Demo cashier'};window.systemReady=true;window.posPlatform='Standard';
localStorage.setItem('takodeal_device_branch','Cabantian');localStorage.setItem('takodeal_cashier_seen_release','cashier-tablet-20261004-r3');
window.masterPOSData.items=Array.from({length:18},(_,i)=>({id:'demo'+i,name:['Double Grilled','Spanish Latte','Matcha Latte','Banana Pudding'][i%4]+' '+(i+1),category:i%4?'Coffee':'Takoyaki',price:100+i*10,grabPrice:130+i*10,foodpandaPrice:140+i*10,image:'logo.jpg'}));
window.masterPOSData.categories=['Takoyaki','Coffee'];window.masterPOSData.settings={orderTypes:['Dine-In','Take-Out','Delivery','Grab','Foodpanda'],payMethods:['Cash','GCash','Bank','GoTyme']};
window.openRemittanceModal=async()=>{};window.closeTimeClock=()=>{};window.getParkedOrders=async()=>window.__parked||[];
const db={},collection=(_db,name)=>name,query=(...args)=>args,where=(...args)=>args;
const getDocs=async q=>q[0]==='branches'?{empty:false,docs:[{data:()=>({isMallBranch:true})}]}:{forEach(){}};
window.renderExpenseCart=()=>{};
${expense}
window.addEventListener('load',()=>{document.getElementById('loginOverlay').style.display='none';document.getElementById('displayCashierText').textContent='Demo cashier';document.getElementById('displayBranchText').textContent='Cabantian';document.getElementById('btnTopShift').textContent='Active Shift';});
${renderer}window.renderOrderAndPaymentUI();
</script></body>`);
const browser=await chromium.launch({headless:true,executablePath:process.env.CASHIER_CHROME_BIN || undefined,args:['--no-sandbox']});
const screenshots=process.env.CASHIER_SCREENSHOT_DIR;
if(screenshots)mkdirSync(screenshots,{recursive:true});
async function screenshot(page,name){if(screenshots)await page.screenshot({path:path.join(screenshots,name+'.png'),animations:'disabled'});}
async function fixture(width,height){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}), page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort(); // No test can reach a live account.
    if(url.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:html});
    const file=path.join(root,decodeURIComponent(url.pathname));
    if(!file.startsWith(root)||!existsSync(file))return route.fulfill({status:404,body:'Missing test asset'});
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png'};
    return route.fulfill({contentType:types[path.extname(file)]||'text/plain',body:readFileSync(file)});
  });
  await page.goto(origin+'/fixture');await page.waitForSelector('body.cashier-tablet-controls');
  return {context,page,errors};
}
async function openCheckout(page){await page.evaluate(()=>{
  window.cart=[{name:'Double Grilled',qty:1,basePrice:230,variantPrice:230,lineTotalFinal:230,variantName:'Standard',addons:{}}];
  window.renderCart();document.getElementById('mainOrderType').value=window.posPlatform==='Standard'?'Take-Out':window.posPlatform;window.openCheckoutModal();
});await page.waitForSelector('#checkoutModal[style*="flex"]');}
async function insideViewport(page,selector){
  const box=await page.locator(selector).boundingBox();assert.ok(box,selector+' is visible');
  const viewport=page.viewportSize();assert.ok(box.x>=-1 && box.y>=-1 && box.x+box.width<=viewport.width+1 && box.y+box.height<=viewport.height+1,selector+' stays in the viewport');
}
async function seedClearance(page){await page.evaluate(()=>{
  document.getElementById('denominationTable').innerHTML=[1000,500,200,100,50,20,10,5,1].map(value=>'<tr><td>₱'+value+'</td><td><input type="number" class="input-box" placeholder="0"></td><td>₱0.00</td></tr>').join('');
  document.getElementById('dynamicShiftPrepLogs').innerHTML='<div><strong>W. Mayo</strong><br>11:53 AM · +7,000 grams</div>';
  document.getElementById('dynamicBlindCountList').innerHTML=['Egg L','Solo-Duo Paper Bowl','Burger Box','Hotdog Box','LB1','Coffee Lid'].map(name=>'<div style="display:flex;justify-content:space-between;align-items:center"><strong>'+name+'</strong><div style="display:flex;align-items:center;gap:4px"><input type="number" placeholder="Packs"><span>Tray</span><span>+</span><input type="number" placeholder="Loose"><span>piece</span></div></div>').join('');
});}
try {
  const {page,context,errors}=await fixture(1024,768);
  assert.equal(await page.locator('#mainSidebar').evaluate(e=>e.getBoundingClientRect().width),72);
  assert.ok(await page.locator('#nav-pos svg').count());
  await page.locator('.cashier-sidebar-toggle').click();await page.waitForFunction(()=>Math.abs(document.getElementById('mainSidebar').getBoundingClientRect().width-220)<1);
  assert.equal(await page.locator('#nav-pos .nav-item-text').isVisible(),true);await screenshot(page,'sidebar-expanded');
  assert.equal(await page.locator('.top-bar-right #btnTopShift').count(),0);
  await page.locator('.cashier-sidebar-toggle').click();await page.waitForFunction(()=>Math.abs(document.getElementById('mainSidebar').getBoundingClientRect().width-72)<1);
  assert.equal(await page.locator('#tkMenuSearch').count(),0);assert.equal(await page.locator('#menuCategoryDropdown').isVisible(),false);
  await page.locator('#tkBrowseCategories').click();await page.locator('.tk-category-option[data-category="Takoyaki"]').click();
  assert.equal(await page.locator('#menuGrid .tk-product-card:visible').count(),5);
  await page.locator('#tkBrowseCategories').click();await page.locator('.tk-category-option[data-category="All"]').click();
  await page.locator('.cashier-side-settings > button').click();await insideViewport(page,'#posSettingsDropdown');await screenshot(page,'settings');await page.locator('.cashier-side-settings > button').click();
  await openCheckout(page);
  assert.deepEqual(await page.locator('.payment-grid [data-payment-method]').evaluateAll(nodes=>nodes.map(n=>n.dataset.paymentMethod)),['Cash','GCash','Bank','GoTyme']);
  assert.ok(await page.locator('[data-payment-method="GCash"] img').evaluate(img=>img.complete && img.naturalWidth>0));
  await page.locator('[data-payment-method="GCash"]').click();assert.equal(await page.evaluate(()=>window.selectedPaymentMethod),'GCash');assert.equal(await page.evaluate(()=>window.amountReceivedStr),'230');
  await page.evaluate(()=>window.renderOrderAndPaymentUI());assert.equal(await page.evaluate(()=>window.selectedPaymentMethod),'GCash');assert.equal(await page.locator('#mainOrderType').inputValue(),'Take-Out');
  await page.locator('[data-payment-method="Cash"]').click();assert.equal(await page.evaluate(()=>window.amountReceivedStr),'0');
  await page.locator('.split-btn').click();await page.locator('#splitAmount1').fill('100');await page.locator('#splitAmount2').fill('130');assert.equal(await page.locator('#btnSubmitFinal').isDisabled(),false);
  await page.locator('#splitAmount2').fill('131');assert.equal(await page.locator('#btnSubmitFinal').isDisabled(),true);
  await page.locator('#splitAmount2').fill('130');await page.evaluate(()=>window.renderOrderAndPaymentUI());assert.equal(await page.evaluate(()=>window.selectedPaymentMethod),'Split');
  await page.locator('#checkoutDiscountType').selectOption('percentage');await page.locator('#checkoutDiscountValue').fill('10');
  assert.equal(await page.locator('#btnSubmitFinal').isDisabled(),true);
  await page.locator('#checkoutDiscountValue').fill('0');assert.equal(await page.locator('#btnSubmitFinal').isDisabled(),false);
  await page.locator('#checkoutDiscountType').selectOption('staff_meal');assert.equal(await page.locator('#finalCustomerName').getAttribute('readonly'),'');
  await page.locator('#checkoutModal .close-modal').click();await openCheckout(page);assert.equal(await page.locator('#splitPaymentContainer').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.selectedPaymentMethod),'Cash');
  assert.equal(await page.locator('#finalCustomerName').getAttribute('readonly'),null);
  await page.evaluate(()=>{window.masterPOSData.settings.payMethods=['Cash',"Owner's Bank"];window.renderOrderAndPaymentUI();});
  await page.locator('[data-payment-method="Owner\'s Bank"]').click();assert.equal(await page.evaluate(()=>window.selectedPaymentMethod),"Owner's Bank");
  await page.evaluate(()=>{window.__submitted=[];window.processCheckout=payload=>new Promise(resolve=>{window.__submitted.push(payload);window.__resolveCheckout=resolve;});document.getElementById('finalCustomerName').value='Demo reference';window.submitFinalOrder();window.submitFinalOrder();});
  assert.equal(await page.evaluate(()=>window.__submitted.length),1);assert.equal(await page.evaluate(()=>window.__submitted[0].paymentMethod),"Owner's Bank");
  await page.evaluate(()=>window.__resolveCheckout({status:'failed',error:'Test fixture; no sale written'}));
  await page.locator('#checkoutModal .close-modal').click();
  await page.evaluate(()=>{window.masterPOSData.settings.payMethods=['Cash','GCash','Bank','GoTyme'];window.renderOrderAndPaymentUI();});
  for(const [platform,color] of [['Grab','rgb(0, 166, 75)'],['Foodpanda','rgb(215, 15, 100)']]){
    await page.selectOption('#posPlatformSelect',platform);await page.waitForFunction(color=>getComputedStyle(document.getElementById('posPlatformSelect')).backgroundColor===color,color);
    await screenshot(page,platform.toLowerCase());await openCheckout(page);
    assert.equal(await page.evaluate(()=>window.selectedPaymentMethod),platform);assert.equal(await page.locator('.payment-grid button').count(),1);assert.equal(await page.locator('.payment-grid button').isDisabled(),true);
    assert.equal(await page.locator('.numpad-grid').isVisible(),false);await screenshot(page,platform.toLowerCase()+'-checkout');await page.locator('#checkoutModal .close-modal').click();
    await openCheckout(page);await page.locator('#checkoutDiscountType').selectOption('fixed');
    assert.equal(await page.locator('.payment-grid').isVisible(),true);assert.equal(await page.evaluate(()=>window.selectedPaymentMethod),platform);
    await page.locator('#checkoutModal .close-modal').click();
  }
  await page.selectOption('#posPlatformSelect','Standard');await openCheckout(page);assert.equal(await page.locator('.numpad-grid').isVisible(),true);await screenshot(page,'checkout-tablet');await page.locator('#checkoutModal .close-modal').click();
  await page.evaluate(()=>window.showParkedOrders());await page.waitForSelector('.cashier-parked-empty');await screenshot(page,'parked-empty');await page.locator('#parkedModal .close-modal').click();
  await page.evaluate(()=>{window.__parked=[{id:'demo-order',name:'Table 03 · Ana',total:230,items:[{name:'Double Grilled',qty:1,lineTotalFinal:230,variantName:'Standard',addons:{}}]}];window.showParkedOrders();});
  await page.waitForSelector('.cashier-parked-card');assert.match(await page.locator('.cashier-parked-card').innerText(),/Resume & Pay/);await screenshot(page,'parked-orders');await page.locator('#parkedModal .close-modal').click();
  assert.deepEqual(errors,[]);await context.close();console.log('PASS: sidebar, categories, configured payments, split totals, single submission and platform themes');

  for(const [width,height] of [[1366,900],[1024,768],[800,600],[768,1024],[600,960],[400,800]]){
    const {context,page,errors}=await fixture(width,height);await screenshot(page,'pos-'+width);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'POS has no horizontal overflow at '+width);
    if(width<=768){await page.locator('.tk-dock-btn[data-target="more"]').click();assert.equal(await page.locator('.cashier-side-settings > button').isVisible(),true);await page.locator('.tk-dock-btn[data-target="more"]').click();}
    await openCheckout(page);await insideViewport(page,'#checkoutModal > .modal');await insideViewport(page,'#btnSubmitFinal');
    assert.equal(await page.locator('[data-payment-method="GCash"]').isVisible(),true);await screenshot(page,'checkout-'+width);await page.locator('#checkoutModal .close-modal').click();
    await seedClearance(page);
    for(const id of ['shiftModal','endShiftModal','expenseModal']){
      await page.evaluate(async id=>{if(id==='shiftModal'){document.getElementById('shiftViewClose').style.display='block';document.getElementById('shiftActiveDetails').textContent='Started by Demo cashier · Oct 4, 2026 · 10:00 AM';document.getElementById('scStartingCash').textContent='₱2,000.00';document.getElementById('scCashOut').textContent='− ₱150.00';}if(id==='expenseModal')await window.openExpenseModal();else document.getElementById(id).style.display='flex';},id);
      await insideViewport(page,'#'+id+' > .modal');
      assert.ok(await page.locator('#'+id+' .modal-body:visible').evaluate(e=>e.scrollWidth<=e.clientWidth+1),id+' has no horizontal overflow at '+width);
      if(id!=='shiftModal')await insideViewport(page,'#'+id+' .modal-foot');
      if(id==='expenseModal'){await page.locator('#expFundSource').selectOption('Manager Fund');assert.equal(await page.locator('#expFundSource').inputValue(),'Manager Fund');}
      await screenshot(page,id+'-'+width);await page.locator('#'+id+' .close-modal').click();
    }
    assert.deepEqual(errors,[]);await context.close();console.log('PASS: dialogs and POS layout at '+width+'×'+height);
  }
} finally {await browser.close();}
