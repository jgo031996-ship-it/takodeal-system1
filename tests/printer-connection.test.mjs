import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createPrinterConnections,createPrinterWriter,printerMode,rawBtIntent,receiptLogoDimensions} from '../Takodeal-POS/printer-connection.js';

function setup({remembered=true,canRecall=true}={}) {
    const values=new Map(remembered?[['takodeal_printer_main_id','printer-1']]:[]);
    const timers=new Map(), events={}, states=[], chunks=[];
    let timerId=0,connects=0,discovery=0,choosers=0,failConnect=false,failWrite=false;
    const device={id:'printer-1',name:'Receipt printer',addEventListener(name,handler){(events[name]??=[]).push(handler);}};
    const service={device,uuid:'000018f0-0000-1000-8000-00805f9b34fb',async getCharacteristics(){discovery++;return [character];}};
    const character={service,uuid:'00002af1-0000-1000-8000-00805f9b34fb',properties:{writeWithoutResponse:true},async writeValueWithoutResponse(chunk){if(failWrite)throw Error('disconnected');chunks.push([...chunk]);}};
    device.gatt={connected:false,async connect(){connects++;if(failConnect)throw Error('printer asleep');this.connected=true;return this;},async getPrimaryServices(){return [service];}};
    const bluetooth={async requestDevice(){choosers++;return device;},...(canRecall?{async getDevices(){return [device];}}:{})};
    const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
    const connections=createPrinterConnections({bluetooth,storage,onState:(role,state)=>states.push({role,...state}),schedule:fn=>{const id=++timerId;timers.set(id,fn);return id;},cancel:id=>timers.delete(id)});
    return {connections,device,service,character,chunks,events,states,timers,values,get connects(){return connects;},get choosers(){return choosers;},get discovery(){return discovery;},set failConnect(value){failConnect=value;},set failWrite(value){failWrite=value;},async disconnect(){device.gatt.connected=false;for(const fn of events.gattserverdisconnected||[])fn();},async tick(){const [id,fn]=timers.entries().next().value;timers.delete(id);await fn();await new Promise(resolve=>setImmediate(resolve));}};
}
test('remembered printer reconnects silently without opening the pairing chooser',async()=>{
    const app=setup();await app.connections.reconnect();assert.equal(app.connections.snapshot('main').connected,true);assert.equal(app.choosers,0);assert.equal(app.connects,1);
});
test('failed reconnect keeps retrying after printer wakes up',async()=>{
    const app=setup();app.failConnect=true;await app.connections.reconnect();assert.equal(app.timers.size,1);
    await app.tick();assert.equal(app.timers.size,1);assert.equal(app.connects,2);
    app.failConnect=false;await app.tick();assert.equal(app.connections.snapshot('main').connected,true);assert.equal(app.timers.size,0);
});
test('repeated idle disconnects reuse one listener and one recovery timer',async()=>{
    const app=setup();await app.connections.connect('main');await app.disconnect();await app.disconnect();assert.equal(app.timers.size,1);
    await app.tick();await app.disconnect();await app.tick();assert.equal(app.events.gattserverdisconnected.length,1);assert.equal(app.connects,3);
});
test('simultaneous connect requests share GATT discovery',async()=>{
    const app=setup();await Promise.all([app.connections.connect('main'),app.connections.connect('main'),app.connections.reconnect()]);
    assert.equal(app.connects,1);assert.equal(app.discovery,1);
});
test('lost characteristic is rediscovered on an already connected device',async()=>{
    const app=setup();await app.connections.connect('main');app.connections.invalidate('main');await app.connections.reconnect();
    assert.equal(app.connects,1);assert.equal(app.discovery,2);assert.equal(app.connections.ready('main'),app.character);
});
test('manual pairing survives idle disconnect even when getDevices is unavailable',async()=>{
    const app=setup({remembered:false,canRecall:false});await app.connections.connect('main',{choose:true});await app.disconnect();await app.tick();
    assert.equal(app.choosers,1);assert.equal(app.connects,2);
});
test('background recovery never scans for an unpaired printer',async()=>{
    const app=setup({remembered:false});await app.connections.reconnect();assert.equal(app.choosers,0);assert.equal(app.connects,0);
});
test('before printing, a disconnected printer is recovered and only one receipt is sent',async()=>{
    const app=setup(),writer=createPrinterWriter(app.connections,{wait:async()=>{}});await app.connections.connect('main');await app.disconnect();
    await writer.send(new Uint8Array(250));assert.equal(app.connects,2);assert.deepEqual(app.chunks.map(chunk=>chunk.length),[...Array(12).fill(20),10]);
});
test('queued jobs reconnect at execution time instead of using stale characteristics',async()=>{
    const app=setup();let waits=0;
    const writer=createPrinterWriter(app.connections,{wait:async()=>{if(++waits===2)await app.disconnect();}});
    await Promise.all([writer.send([1]),writer.send([2])]);assert.deepEqual(app.chunks,[[1],[2]]);assert.equal(app.connects,2);
});
test('partial receipt failure is reported without replay and the next job can recover',async()=>{
    const app=setup();let writes=0;
    app.character.writeValueWithoutResponse=async chunk=>{if(++writes===2)throw Error('link dropped');app.chunks.push([...chunk]);};
    const writer=createPrinterWriter(app.connections,{wait:async()=>{}});
    await assert.rejects(writer.send(new Uint8Array(250)),error=>error.bytesWritten===20);
    assert.equal(app.chunks.length,1);app.character.writeValueWithoutResponse=async chunk=>app.chunks.push([...chunk]);
    await writer.send([7]);assert.equal(app.chunks.length,2);assert.deepEqual(app.chunks[1],[7]);
});
test('printer pause cancels background retry until the page is active again',async()=>{
    const app=setup();app.failConnect=true;await app.connections.reconnect();app.connections.pause();assert.equal(app.timers.size,0);
    app.failConnect=false;await app.connections.reconnect();assert.equal(app.connections.snapshot('main').connected,true);
});

test('receipt data endpoint wins over an earlier writable settings characteristic',async()=>{
    const app=setup();let controlWrites=0;
    app.service.getCharacteristics=async()=>[{service:app.service,uuid:'00002af0-0000-1000-8000-00805f9b34fb',properties:{write:true},async writeValue(){controlWrites++;}},app.character];
    const writer=createPrinterWriter(app.connections,{wait:async()=>{}});
    await writer.send([1,2,3]);assert.equal(controlWrites,0);assert.deepEqual(app.chunks,[[1,2,3]]);
    assert.equal(app.connections.snapshot('main').endpoint,app.character.uuid);
});

test('an unrelated writable Bluetooth service is not reported as a receipt printer',async()=>{
    const app=setup();app.service.uuid='0000180f-0000-1000-8000-00805f9b34fb';
    await assert.rejects(app.connections.connect('main'),error=>error.code==='printer-unsupported');
    assert.equal(app.connections.snapshot('main').status,'unsupported');assert.equal(app.connections.snapshot('main').connected,false);
    await app.connections.reconnect();assert.equal(app.connects,1);assert.equal(app.timers.size,0);
});

test('ambiguous printer control channels do not silently accept receipt bytes',async()=>{
    const app=setup();app.character.uuid='00002af0-0000-1000-8000-00805f9b34fb';
    app.service.getCharacteristics=async()=>[app.character,{...app.character,uuid:'00002af2-0000-1000-8000-00805f9b34fb'}];
    await assert.rejects(app.connections.connect('main'),error=>error.code==='printer-unsupported');assert.equal(app.chunks.length,0);
});

test('a unique writable firmware endpoint on a known printer service remains supported',async()=>{
    const app=setup();app.character.uuid='custom-firmware-endpoint';
    await app.connections.connect('main');assert.equal(app.connections.ready('main'),app.character);
});

test('Search again restores the pairing chooser even when a remembered printer is connected',async()=>{
    const app=setup();await app.connections.connect('main');assert.equal(app.choosers,0);
    await app.connections.connect('main',{choose:true,replace:true});assert.equal(app.choosers,1);
    assert.equal(app.connections.snapshot('main').connected,true);
});

test('both write methods use acknowledged writes when supported and legacy writers remain usable',async()=>{
    const app=setup();let acknowledged=0,legacy=0;
    app.character.properties.write=true;
    app.character.writeValueWithResponse=async()=>{acknowledged++;};
    const writer=createPrinterWriter(app.connections,{wait:async()=>{}});
    await writer.send(new Uint8Array(41));assert.equal(acknowledged,3);assert.equal(app.chunks.length,0);
    delete app.character.writeValueWithResponse;app.character.writeValue=async()=>{legacy++;};
    await writer.send(new Uint8Array(41));assert.equal(legacy,3);
});

test('test print does not silently fall back to the main printer when testing another role',async()=>{
    const app=setup(),writer=createPrinterWriter(app.connections,{wait:async()=>{}});
    await assert.rejects(writer.send([1],'kitchen',{fallback:false}),/Connect this printer once/);
    assert.equal(app.chunks.length,0);assert.equal(app.connects,0);
    await writer.send([1],'kitchen');assert.deepEqual(app.chunks,[[1]]);
});

test('Classic Bluetooth bridge preserves every raw ESC-POS byte, including raster and drawer data',()=>{
    const input=Uint8Array.from([0,1,27,29,64,127,128,150,255]);
    const intent=rawBtIntent(input,value=>Buffer.from(value,'binary').toString('base64'));
    const base64=intent.slice('intent:base64,'.length,intent.indexOf('#Intent;'));
    assert.deepEqual([...Buffer.from(base64,'base64')],[...input]);
    assert.match(intent,/scheme=rawbt;package=ru\.a402d\.rawbtprinter;end;$/);
    assert.throws(()=>rawBtIntent(new Uint8Array(131073)),/too large/);
});

test('58mm logo uses the Owner paper setting and respects both width and height scales',()=>{
    assert.deepEqual(receiptLogoDimensions({width:100,height:100,scaleWidth:3,scaleHeight:1,paperSize:'58mm'}),{width:384,height:384});
    assert.deepEqual(receiptLogoDimensions({width:100,height:100,scaleWidth:3,scaleHeight:1,paperSize:'80mm'}),{width:576,height:576});
    assert.deepEqual(receiptLogoDimensions({width:100,height:100,scaleWidth:1,scaleHeight:2,paperSize:'58mm'}),{width:200,height:400});
    assert.equal(receiptLogoDimensions({width:1,height:5000,scaleWidth:1,scaleHeight:3}).height,576);
    assert.throws(()=>receiptLogoDimensions({width:0,height:20}),/usable dimensions/);
});

test('Classic bridge disables browser Bluetooth background reconnection without deleting remembered pairing',async()=>{
    const app=setup();app.values.set('takodeal_printer_mode','rawbt');
    assert.equal(printerMode({getItem:key=>app.values.get(key)}),'rawbt');
    await app.connections.reconnect();assert.equal(app.connects,0);assert.equal(app.choosers,0);
    assert.equal(app.values.get('takodeal_printer_main_id'),'printer-1');
});

test('a hung write times out, preserves uncertainty, and does not automatically replay the receipt',async()=>{
    const app=setup();let expire,writes=0;
    app.character.writeValueWithoutResponse=()=>{writes++;return new Promise(()=>{});};
    const writer=createPrinterWriter(app.connections,{wait:async()=>{},schedule:fn=>{expire=fn;return 1;},cancel:()=>{}});
    const job=writer.send([1,2,3]);
    while(!expire)await new Promise(resolve=>setImmediate(resolve));
    expire();await assert.rejects(job,error=>error.code==='printer-write-timeout'&&error.bytesWritten===0&&error.bytesAttempted===3);
    assert.equal(writes,1);assert.equal(app.connections.ready('main'),null);
});

test('a hung GATT connection times out and cannot report a late ready state',async()=>{
    let expire,connected=false;const device={id:'hang',name:'JP58H',addEventListener(){},gatt:{connected:false,connect:()=>new Promise(()=>{})}};
    const connections=createPrinterConnections({bluetooth:{requestDevice:async()=>device},storage:{getItem(){return null;}},schedule:fn=>{expire=fn;return 1;},cancel(){},onState:(_role,state)=>{connected ||= state.status==='connected';}});
    const job=connections.connect('main',{choose:true});
    while(!expire)await new Promise(resolve=>setImmediate(resolve));
    expire();await assert.rejects(job,error=>error.code==='printer-timeout');assert.equal(connected,false);
});

function printerIntegration({fail=false,confirmed=false,mode='ble'}={}) {
    const source=fs.readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
    const dialogs=[],events=[],sent=[];const values=new Map([['takodeal_printer_mode',mode]]);
    const app={addEventListener(){},location:{href:''},stringToBuffer:value=>Uint8Array.from([...value].map(char=>char.charCodeAt(0)))};
    const connections={connect:async()=>{},pause(){},reconnect(){},snapshot(){return {connected:true,status:'connected',service:'receipt-service',endpoint:'receipt-data'};}};
    const context={window:app,navigator:{userAgent:'Android'},localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)},document:{hidden:false,addEventListener(){},dispatchEvent(event){events.push(event);}},CustomEvent:class{constructor(name,{detail}){this.type=name;this.detail=detail;}},setInterval(){},createPrinterConnections:()=>connections,createPrinterWriter:()=>({send:async(data,role,options)=>{sent.push({data,role,options});if(fail)throw Error('The receipt channel rejected the write.');return true;}}),printerMode,rawBtIntent,console:{warn(){}},Swal:{async fire(...args){dialogs.push(args);if(args[0]?.preConfirm)args[0].preConfirm();return {isConfirmed:confirmed,isDenied:!confirmed};}}};
    context.Uint8Array=Uint8Array;
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('const printerResults = new Map();'),source.indexOf('// 🛡️ RAW BYTE ENGINE')),context);
    vm.runInContext(source.slice(source.indexOf('let pendingPrinterJobs = 0;'),source.indexOf('// Auto-override the sidebar button')),context);
    return {app,dialogs,events,sent};
}

test('actual Printer Hub test shows the write error and never asks a false-success confirmation',async()=>{
    const {app,dialogs}=printerIntegration({fail:true}),button={innerText:'Test print',disabled:false};
    const result=await app.testPrint('main',{currentTarget:button});assert.equal(result,false);
    assert.equal(dialogs.length,1);assert.equal(dialogs[0][0],'Print not completed');assert.match(dialogs[0][1],/rejected the write/);
    assert.equal(app.getPrinterDiagnostics('main').result.status,'failed');assert.equal(button.disabled,false);assert.equal(button.innerText,'Test print');
});

test('actual test uses a plain 58mm payload and records nothing-printed independently of accepted Bluetooth data',async()=>{
    const {app,dialogs,sent}=printerIntegration({confirmed:false});await app.testPrint('main');
    const text=String.fromCharCode(...sent[0].data);
    assert.match(text,/TAKODEAL PRINTER TEST/);assert.ok(!text.includes('\x1d\x76'));assert.ok(!text.includes('\x1d\x56'));
    assert.equal(sent[0].options.fallback,false);assert.equal(dialogs[0][0].title,'Did the test print on paper?');
    assert.equal(app.getPrinterDiagnostics('main').result.status,'no-paper');assert.match(app.getPrinterDiagnostics('main').result.message,/Classic Bluetooth/);
});

test('actual ticket transport routes food and drink jobs to kitchen and bar',async()=>{
    const {app,sent}=printerIntegration();await app.sendToBluetoothPrinter('FOOD',false,'food');await app.sendToBluetoothPrinter('DRINK',false,'drinks');
    assert.deepEqual(sent.map(job=>job.role),['kitchen','bar']);
});

test('actual Android bridge asks before launching and never reports verified paper output',async()=>{
    const {app,dialogs,sent}=printerIntegration({mode:'rawbt',confirmed:true});
    await app.sendToBluetoothPrinter(Uint8Array.from([27,64,150,255]));
    assert.equal(sent.length,0);assert.equal(dialogs[0][0].confirmButtonText,'Open Android printing');
    assert.match(app.location.href,/^intent:base64,/);assert.equal(app.getPrinterDiagnostics('main').result.status,'handed-off');
    assert.equal(app.getPrinterState('main').connected,false);
});

test('actual receipt preserves drawer command bytes and passes Owner paper and logo settings',async()=>{
    const main=fs.readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
    const html=fs.readFileSync(new URL('../Takodeal-POS/index.html',import.meta.url),'utf8');
    const sent=[],logos=[],values=new Map([['takodeal_device_branch','Maa']]);
    const app={lastTransactionData:{cart:[{name:'Test item',qty:1,price:10}],netTotal:10,amountReceived:10,paymentMethod:'Cash',cashierName:'Staff'},
        collection(){},query(){},where(){},async getDocs(){return {empty:false,docs:[{data:()=>({printerSize:'58mm',receiptLogoBase64:'test-logo',logoWidthScale:2,logoHeightScale:3})}]};},
        async encodeImageForPrinter(...args){logos.push(args);return new Uint8Array([29,118,48,0]);},
        concatBuffers(buffers){const all=new Uint8Array(buffers.reduce((n,b)=>n+b.length,0));let offset=0;for(const b of buffers){all.set(b,offset);offset+=b.length;}return all;},
        async sendToBluetoothPrinter(...args){sent.push(args);return true;}};
    const context={window:app,Uint8Array,localStorage:{getItem:key=>values.get(key)||null},document:{getElementById(){return {value:'DINE-IN'};}}};vm.createContext(context);
    vm.runInContext(main.slice(main.indexOf('window.stringToBuffer = function(str)'),main.indexOf('window.concatBuffers = function')),context);
    vm.runInContext(html.slice(html.indexOf('window.printReceipt = async function(type)'),html.indexOf('window.currentParkedOrdersList = []')),context);
    await app.printReceipt('receipt');
    assert.deepEqual([...sent[0][0].subarray(3,8)],[0x1b,0x70,0,0x19,0x96]);
    assert.deepEqual(logos[0],['test-logo',2,3,'58mm']);
    values.set('takodeal_auto_drawer','false');sent.length=0;await app.printReceipt('receipt');
    assert.deepEqual([...sent[0][0].subarray(3,6)],[0x1b,0x61,1]);
});
