import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {loadPrinterLogo,printerLogoDimensions} from '../Takodeal-POS/printer-logo.js';
import {printerMode,rawBtIntent} from '../Takodeal-POS/printer-connection.js';

const main=fs.readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const html=fs.readFileSync(new URL('../Takodeal-POS/index.html',import.meta.url),'utf8').replaceAll('\r\n','\n');
function segment(source,start,end){
    const from=source.indexOf(start),to=source.indexOf(end,from);
    assert.ok(from>=0 && to>from,'Actual printer integration source is available.');
    return source.slice(from,to);
}
function contains(bytes,sequence){
    return bytes.some((_,at)=>sequence.every((value,index)=>bytes[at+index]===value));
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

function runtime({paper='58mm',mode,scaleWidth=1,scaleHeight=1,brokenImage=false,canvasError=false,
    textFallback=false,paperConfirmed=false,writeError=null,settingsGate=null,imageGate=null,drawer=true}={}){
    const values=new Map([['takodeal_device_branch','Agdao'],['takodeal_printer_mode','ble']]);
    if(mode!==undefined)values.set('takodeal_receipt_logo_mode',mode);
    if(!drawer)values.set('takodeal_auto_drawer','false');
    const state={dialogs:[],sent:[],events:[],loads:[],imageCount:0,canvasCount:0,readCount:0,businessWrites:0,encoded:[]};
    const forbidden=()=>{state.businessWrites++;throw Error('Printer tests must not write business records.');};
    const app={db:{},location:{href:''},addEventListener(){},setDoc:forbidden,updateDoc:forbidden,addDoc:forbidden,deleteDoc:forbidden,runTransaction:forbidden,
        collection(_db,name){assert.equal(name,'branches');return name;},query(...args){return args;},where(...args){return args;},
        async getDocs(){state.readCount++;if(settingsGate)await settingsGate.promise;return {empty:false,docs:[{data:()=>({printerSize:paper,receiptLogoBase64:'data:image/png;base64,synthetic-only',logoWidthScale:scaleWidth,logoHeightScale:scaleHeight,headerName:'TAKODEAL',address:'Synthetic receipt test',footerMessage:'Thank you!'})}]};},
        lastTransactionData:{cart:[{name:'Synthetic item',qty:2,price:100,category:'Food'}],netTotal:175,globalDiscountAmount:25,globalDiscountReason:'Synthetic discount',amountReceived:200,paymentMethod:'Cash',cashierName:'Test Cashier',receiptId:'LOCAL-TEST',orderType:'DINE-IN'}};
    const connections={connect:async()=>{},pause(){},reconnect(){},snapshot(){return {status:'connected',connected:true,service:'mock-service',endpoint:'mock-write'};}};
    const context={window:app,Uint8Array,console:{warn(){}},navigator:{userAgent:'Android'},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},
        document:{hidden:false,addEventListener(){},dispatchEvent:event=>state.events.push(event),getElementById(){return {value:'DINE-IN'};}},
        CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},setInterval(){},
        createPrinterConnections:()=>connections,createPrinterWriter:()=>({async send(data,role,options){state.sent.push({data,role,options});if(writeError)throw writeError;return true;}}),printerMode,rawBtIntent,
        Swal:{async fire(...args){state.dialogs.push(args);const config=args[0];if(config?.confirmButtonText==='Print text only')return {isConfirmed:textFallback};if(config?.confirmButtonText==='Yes, both printed')return {isConfirmed:paperConfirmed,isDenied:!paperConfirmed};return {isConfirmed:false};}},
        async loadPrinterLogo(source,options){
            state.loads.push({source,options:{...options}});
            const bytes=await loadPrinterLogo(source,{...options,
                imageFactory(){
                    state.imageCount++;
                    const image={naturalWidth:160,naturalHeight:80,onload:null,onerror:null};
                    Object.defineProperty(image,'src',{set(value){assert.match(value,/^data:image\/png/);Promise.resolve(imageGate?.promise).then(()=>{if(brokenImage)image.onerror?.();else image.onload?.();});}});
                    return image;
                },
                canvasFactory(){
                    state.canvasCount++;const canvas={};
                    canvas.getContext=()=>({fillStyle:'',fillRect(){assert.equal(this.fillStyle,'#ffffff');},drawImage(){},getImageData(){
                        if(canvasError)throw Error('Canvas image access refused.');
                        const data=new Uint8ClampedArray(canvas.width*canvas.height*4).fill(255);
                        // Known opaque black pixels make the real packet non-empty.
                        data[0]=data[1]=data[2]=0;
                        return {data};
                    }});
                    return canvas;
                }});
            state.encoded.push(bytes);return bytes;
        }};
    vm.createContext(context);
    vm.runInContext(segment(main,'const printerResults = new Map();','// Auto-override the sidebar button'),context);
    vm.runInContext(segment(html,'window.printReceipt = async function(type)','window.currentParkedOrdersList = []'),context);
    return {app,state,values};
}

for(const config of [
    {paper:'58mm',scaleWidth:1,scaleHeight:1,expectedMode:'compatible'},
    {paper:'58mm',scaleWidth:2,scaleHeight:3,expectedMode:'compatible'},
    {paper:'80mm',scaleWidth:1,scaleHeight:1,expectedMode:'raster'},
    {paper:'80mm',scaleWidth:.5,scaleHeight:2,mode:'compatible',expectedMode:'compatible'},
    {paper:'58mm',mode:'raster',expectedMode:'raster'},
])test(`actual receipt decodes ${config.paper} ${config.expectedMode} with Owner scales ${config.scaleWidth||1}/${config.scaleHeight||1}`,async()=>{
    const {app,state}=runtime(config);await app.printReceipt('receipt');
    assert.equal(state.loads.length,1);assert.deepEqual(state.loads[0].options,{paperSize:config.paper,scaleWidth:config.scaleWidth||1,scaleHeight:config.scaleHeight||1,mode:config.expectedMode});
    const dimensions=printerLogoDimensions({width:160,height:80,...state.loads[0].options});
    const logo=state.encoded[0],firstHeader=config.expectedMode==='compatible'?6:3;
    if(config.expectedMode==='compatible'){
        assert.deepEqual([...logo.slice(firstHeader,firstHeader+5)],[27,42,33,dimensions.width&255,dimensions.width>>8]);
        assert.equal(logo.pauseAfterBytes.length,Math.ceil(dimensions.height/24));
    }else{
        assert.deepEqual([...logo.slice(firstHeader,firstHeader+8)],[29,118,48,0,Math.ceil(dimensions.width/8)&255,Math.ceil(dimensions.width/8)>>8,16,0]);
        assert.equal(logo.pauseAfterBytes.length,Math.ceil(dimensions.height/16));
    }
    assert.equal(state.sent.length,1);const {data,role,options}=state.sent[0];
    assert.equal(role,'main');assert.deepEqual([...data.slice(11,11+logo.length)],[...logo]);
    assert.deepEqual([...data.pauseAfterBytes],logo.pauseAfterBytes.map(offset=>11+offset));
    assert.deepEqual([...options.pauseAfterBytes],[...data.pauseAfterBytes]);assert.equal(options.bandDelay,120);
    assert.equal(state.businessWrites,0);
});

test('actual concatenation preserves binary data and shifts every explicit band boundary',async()=>{
    const {app,state}=runtime();await app.encodeImageForPrinter('data:image/png;base64,synthetic-only',1,1,'58mm');
    const logo=state.encoded[0],result=app.concatBuffers([Uint8Array.from([255,150]),logo,Uint8Array.from([27,64,0]),logo]);
    assert.deepEqual([...result.slice(2,2+logo.length)],[...logo]);
    assert.deepEqual([...result.pauseAfterBytes],[...logo.pauseAfterBytes.map(offset=>offset+2),...logo.pauseAfterBytes.map(offset=>offset+logo.length+5)]);
    assert.equal(Object.keys(result).includes('pauseAfterBytes'),false);assert.ok(Object.isFrozen(result.pauseAfterBytes));
});

test('Text only skips image/canvas work and keeps actual receipt totals and drawer bytes',async()=>{
    const {app,state}=runtime({mode:'none'});await app.printReceipt('receipt');
    assert.equal(state.imageCount,0);assert.equal(state.canvasCount,0);assert.equal(state.encoded[0].length,0);
    assert.equal(state.sent.length,1);const job=state.sent[0],text=Buffer.from(job.data).toString('latin1');
    assert.deepEqual([...job.data.slice(3,8)],[27,112,0,25,150]);
    assert.match(text,/Subtotal:\s+200\.00/);assert.match(text,/Order Discount:\s+-25\.00/);assert.match(text,/TOTAL DUE\n\x1b!0175\.00/);
    assert.match(text,/Cash Given:\s+200\.00/);assert.match(text,/Change Amount:\s+25\.00/);
    assert.equal(job.data.pauseAfterBytes,undefined);assert.equal(job.options.bandDelay,undefined);assert.equal(state.dialogs.length,0);assert.equal(state.businessWrites,0);
    const withoutDrawer=runtime({mode:'none',drawer:false});await withoutDrawer.app.printReceipt('receipt');
    assert.equal(contains(withoutDrawer.state.sent[0].data,[27,112,0,25,150]),false);
});

test('a failed logo preparation asks before any data; cancellation sends no drawer or receipt',async()=>{
    const {app,state}=runtime({brokenImage:true});assert.equal(await app.printReceipt('receipt'),false);
    assert.equal(state.sent.length,0);assert.equal(state.dialogs.length,1);
    assert.equal(state.dialogs[0][0].confirmButtonText,'Print text only');assert.match(state.dialogs[0][0].text,/No print data has been sent/);
    assert.equal(app.getPrinterDiagnostics('main').logoResult.status,'preparation-failed');assert.equal(state.businessWrites,0);
});

test('explicit text-only fallback sends exactly one unchanged financial receipt after preparation fails',async()=>{
    const {app,state}=runtime({canvasError:true,textFallback:true});await app.printReceipt('receipt');
    assert.equal(state.sent.length,1);const job=state.sent[0],text=Buffer.from(job.data).toString('latin1');
    assert.match(text,/TOTAL DUE\n\x1b!0175\.00/);assert.deepEqual([...job.data.slice(3,8)],[27,112,0,25,150]);
    assert.equal(job.data.pauseAfterBytes,undefined);assert.equal(state.dialogs.length,1);assert.equal(state.businessWrites,0);
});

test('actual logo test sends no drawer, cutter or sale writes and waits for physical confirmation',async()=>{
    const {app,state}=runtime({paperConfirmed:true}),button={disabled:false,innerText:'Test receipt logo'};
    assert.equal(await app.testPrinterLogo('main',{currentTarget:button}),true);
    assert.equal(state.sent.length,1);const {data,role,options}=state.sent[0];
    assert.equal(role,'main');assert.equal(options.fallback,false);assert.equal(options.bandDelay,120);
    assert.equal(contains(data,[27,112,0,25,150]),false);assert.equal(contains(data,[29,86]),false);
    assert.match(Buffer.from(data).toString('latin1'),/TAKODEAL LOGO TEST/);assert.equal(state.businessWrites,0);
    assert.equal(state.dialogs.length,1);assert.equal(state.dialogs[0][0].confirmButtonText,'Yes, both printed');
    assert.equal(app.getPrinterDiagnostics('main').logoResult.status,'paper-confirmed');assert.equal(button.disabled,false);assert.equal(button.innerText,'Test receipt logo');
});

test('accepted logo bytes with no paper are recorded separately and never automatically replayed',async()=>{
    const {app,state}=runtime();assert.equal(await app.testPrinterLogo('main'),false);
    assert.equal(state.sent.length,1);const diagnostics=app.getPrinterDiagnostics('main');
    assert.equal(diagnostics.result.status,'sent');assert.equal(diagnostics.logoResult.status,'no-paper');assert.match(diagnostics.logoResult.message,/not confirmed/);
    assert.equal(state.dialogs.length,1);assert.equal(state.businessWrites,0);
});

test('a partial transport failure never confirms paper output, changes format or replays the logo',async()=>{
    const failure=Object.assign(Error('Synthetic endpoint rejected the remaining bytes.'),{bytesWritten:20,bytesAttempted:40});
    const {app,state,values}=runtime({writeError:failure,mode:'compatible',paperConfirmed:true}),button={disabled:false,innerText:'Test receipt logo'};
    assert.equal(await app.testPrinterLogo('main',{currentTarget:button}),false);
    assert.equal(state.sent.length,1);assert.equal(state.imageCount,1);assert.equal(state.dialogs.length,1);assert.equal(state.dialogs[0][0],'Print not completed');
    assert.match(state.dialogs[0][1],/Check the paper before reprinting/);assert.equal(values.get('takodeal_receipt_logo_mode'),'compatible');
    assert.equal(app.getPrinterDiagnostics('main').result.status,'failed');assert.equal(app.getPrinterDiagnostics('main').logoResult.status,'not-completed');
    assert.equal(button.disabled,false);assert.equal(button.innerText,'Test receipt logo');assert.equal(app.isBluetoothPrinting,false);assert.equal(state.businessWrites,0);
});

test('None mode and non-receipt targets cannot issue a logo test',async()=>{
    const {app,state}=runtime({mode:'none'});assert.equal(await app.testPrinterLogo('main'),false);assert.equal(await app.testPrinterLogo('kitchen'),false);
    assert.equal(state.readCount,0);assert.equal(state.imageCount,0);assert.equal(state.sent.length,0);assert.equal(state.dialogs.length,1);assert.equal(state.businessWrites,0);
});

test('concurrent logo test clicks cannot send a second job while branch or image preparation is pending',async()=>{
    const settingsGate=deferred(),imageGate=deferred(),{app,state}=runtime({settingsGate,imageGate,paperConfirmed:true});
    const first=app.testPrinterLogo('main');assert.equal(await app.testPrinterLogo('main'),false);
    settingsGate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(state.imageCount,1);
    assert.equal(await app.testPrinterLogo('main'),false);assert.equal(state.sent.length,0);
    imageGate.resolve();assert.equal(await first,true);assert.equal(state.sent.length,1);assert.equal(state.readCount,1);
});

test('a profile change during delayed decoding cannot relabel the captured logo or its paper result',async()=>{
    for(const [chosen,next] of [['compatible','raster'],['raster','none']]){
        const imageGate=deferred(),{app,state,values}=runtime({mode:chosen,imageGate,paperConfirmed:true});
        const pending=app.testPrinterLogo('main');await new Promise(resolve=>setImmediate(resolve));
        assert.equal(state.loads.length,1);assert.equal(state.loads[0].options.mode,chosen);assert.equal(state.sent.length,0);
        app.setReceiptLogoMode(next);imageGate.resolve();assert.equal(await pending,true);
        const logo=state.encoded[0],text=Buffer.from(state.sent[0].data).toString('latin1');
        if(chosen==='compatible'){
            assert.deepEqual([...logo.slice(3,6)],[27,51,24]);assert.match(text,/TAKODEAL LOGO TEST\nSmall compatible logo\n/);
        }else{
            assert.deepEqual([...logo.slice(3,7)],[29,118,48,0]);assert.match(text,/TAKODEAL LOGO TEST\nRaster logo\n/);
        }
        const diagnostics=app.getPrinterDiagnostics('main');
        assert.equal(diagnostics.logoResult.mode,chosen);assert.equal(diagnostics.logoResult.status,'paper-confirmed');
        assert.equal(diagnostics.logoMode,next);assert.equal(values.get('takodeal_receipt_logo_mode'),next);assert.equal(state.sent.length,1);
    }
});
