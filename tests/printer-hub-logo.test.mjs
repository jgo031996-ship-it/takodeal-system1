import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../Takodeal-POS/cashier-workspace.js',import.meta.url),'utf8');
const start=source.indexOf("  el('cashierReceiptLogoMode').onchange="),end=source.indexOf('  const label=',start);
const refresh=source.indexOf('function refreshPrinters(){'),refreshEnd=source.indexOf('\nfunction decorateInventory(){',refresh);
assert.ok(start>=0&&end>start&&refresh>=0&&refreshEnd>refresh,'actual Printer Hub handlers and refresh are available');
function harness(){const nodes=new Map(),listeners=new Map(),calls=[];let saved='compatible',fail=false;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',textContent:'',dataset:{},hidden:false,disabled:false,classList:{toggle(){}},setAttribute(){},closest(){return {querySelector:()=>node('connect-'+id)};}});return nodes.get(id);};
 for(const role of ['main','kitchen','bar'])for(const prefix of ['printerState-','printerResult-','printerDetails-','printerSearch-'])node(prefix+role);
 for(const id of ['cashierPrinterMode','cashierPrinterModeHelp','cashierPrinterBridgeSetup','cashierReceiptLogoMode','cashierReceiptLogoHelp','printerLogoResult-main','printerLogoTest-main'])node(id);
 const states={main:{connected:true,status:'ready',mode:'ble',result:null,logoResult:null},kitchen:{connected:false,status:'not-connected',mode:'ble'},bar:{connected:false,status:'not-connected',mode:'ble'}};
 const window={getPrinterDiagnostics:role=>states[role],getReceiptLogoMode:()=>saved,setReceiptLogoMode:value=>{if(fail)throw Error('Device storage is unavailable.');saved=value;listeners.get('cashier-printer-state')?.();},testPrinterLogo:(role,event)=>{calls.push({role,event});return 'logo-request';},Swal:{fire:(...args)=>calls.push({warning:args})}};
 vm.runInNewContext(source.slice(refresh,refreshEnd)+'\n'+source.slice(start,end),{window,el:node,document:{addEventListener:(name,fn)=>listeners.set(name,fn)}});
 listeners.get('cashier-printer-state')();return {node,window,states,calls,listeners,get saved(){return saved;},set fail(value){fail=value;}};
}
test('Logo selection is local and independent of connectivity, and failed storage restores the saved mode',()=>{
 const h=harness();h.states.main.connected=false;h.node('cashierReceiptLogoMode').value='none';h.node('cashierReceiptLogoMode').onchange();assert.equal(h.saved,'none');assert.equal(h.calls.length,0);assert.match(h.node('cashierReceiptLogoHelp').textContent,/without a logo/);
 h.fail=true;h.node('cashierReceiptLogoMode').value='raster';h.node('cashierReceiptLogoMode').onchange();assert.equal(h.saved,'none');assert.equal(h.node('cashierReceiptLogoMode').value,'none');assert.match(h.calls[0].warning[1],/storage/);
});
test('Only the explicit logo button requests a main-printer test and preserves the original click event',()=>{
 const h=harness(),event={currentTarget:h.node('printerLogoTest-main'),isTrusted:true};assert.equal(h.calls.length,0);
 assert.equal(h.node('printerLogoTest-main').onclick(event),'logo-request');assert.equal(h.calls.length,1);assert.equal(h.calls[0].role,'main');assert.equal(h.calls[0].event,event);
 delete h.window.testPrinterLogo;h.node('printerLogoTest-main').onclick(event);assert.equal(h.calls.filter(call=>call.role).length,1);assert.match(h.calls.at(-1).warning[1],/unavailable/);
});
test('Logo help explains Owner sizing and the compatible alternative to a thin raster line without starting a test',()=>{
 const h=harness(),help=h.node('cashierReceiptLogoHelp');
 assert.match(help.textContent,/Owner app’s Width Scale and Height Scale/);assert.match(help.textContent,/matching 1\.5× or 2× values to keep its shape/);assert.match(help.textContent,/Larger logos take longer to print/);
 h.node('cashierReceiptLogoMode').value='raster';h.node('cashierReceiptLogoMode').onchange();assert.equal(h.saved,'raster');assert.match(help.textContent,/one complete raster image/);assert.match(help.textContent,/Run Test logo first/);assert.match(help.textContent,/If only a line prints, use Compatible logo/);assert.equal(h.calls.length,0);
});
test('Text results cannot erase the last logo result or turn a sent job into confirmed paper output',()=>{
 const h=harness();assert.match(h.node('printerLogoResult-main').textContent,/not confirmed/);assert.equal(h.node('cashierReceiptLogoMode').value,'compatible');assert.match(h.node('cashierReceiptLogoHelp').textContent,/Recommended for 58mm/);
 h.states.main.logoResult={status:'sent',message:'Logo data sent. Paper output is not confirmed.'};h.listeners.get('cashier-printer-result')();assert.equal(h.node('printerLogoResult-main').dataset.state,'sent');assert.match(h.node('printerLogoResult-main').textContent,/not confirmed/);
 h.states.main.result={status:'paper-confirmed',message:'Text output confirmed.'};h.listeners.get('cashier-printer-result')();assert.equal(h.node('printerResult-main').textContent,'Text output confirmed.');assert.match(h.node('printerLogoResult-main').textContent,/Logo data sent.*not confirmed/);
 h.states.main.logoResult={status:'no-paper',message:'No logo appeared on paper.'};h.listeners.get('cashier-printer-result')();assert.equal(h.node('printerLogoResult-main').dataset.state,'no-paper');assert.match(h.node('printerLogoResult-main').textContent,/No logo/);
});
