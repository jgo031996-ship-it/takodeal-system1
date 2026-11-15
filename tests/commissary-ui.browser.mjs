import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const runtime=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const {chromium}=runtime?await import(pathToFileURL(runtime+'/playwright/index.mjs')):await import('playwright');
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8043/tests/fixtures/commissary-ui.html');await page.getByRole('button',{name:'Commissary Reconciliation',exact:true}).first().click();await page.getByLabel('Collector',{exact:true}).fill('Fixture Collector');await page.getByLabel('Week starting Monday').fill('2026-11-09');await page.locator('[data-day="0"] [data-amount]').fill('10000');await page.locator('[data-day="0"] [data-reference]').fill('fixture-handover');await page.getByLabel('Cash already remitted').fill('7500');await page.getByRole('button',{name:'Add receipt item',exact:true}).click();
  const receipt=page.locator('[data-receipt]');await receipt.getByLabel('Supplier',{exact:true}).fill('Fixture Supplier');await receipt.getByLabel('Receipt reference',{exact:true}).fill('fixture-receipt');await receipt.getByLabel('Purchase and physical receipt date').fill('2026-11-10');await receipt.getByLabel('Physically received base quantity').fill('24');await receipt.getByLabel('Line cost paid from collections').fill('2500');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Review stock and cash'}).click();await page.locator('[data-preview] table').waitFor();assert.equal(await page.evaluate(()=>fixtureRecords.get('inventory/drink').currentStock),-12);
  assert.equal(await page.evaluate(()=>document.querySelector('dialog').getBoundingClientRect().right<=innerWidth),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/takodeal-commissary-'+width+'.png',fullPage:true});
  if(width===390)await page.evaluate(()=>{const original=window.runTransaction;let lose=true;window.runTransaction=async(...args)=>{const r=await original(...args);if(lose){lose=false;throw Error('Fixture acknowledgement lost after commit');}return r;};});
  await page.getByRole('button',{name:'Approve and post receipts',exact:true}).click();
  if(width===390){await page.getByRole('button',{name:'Retry same weekly posting',exact:true}).waitFor();await page.getByRole('button',{name:'Retry same weekly posting',exact:true}).click();}
  await page.getByText('Saved and confirmed.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>fixtureRecords.get('inventory/drink').currentStock),12);assert.equal(await page.evaluate(()=>[...fixtureRecords].filter(([k])=>k.startsWith('expenses/')).length),1);assert.deepEqual(errors,[]);
  await page.evaluate(()=>{window.auth.currentUser=null;});await page.locator('dialog').waitFor({state:'detached'});await context.close();console.log('PASS '+width+'px: preview, atomic receipt, cash control, retry, and account cleanup');
 }
}finally{await browser.close();}
