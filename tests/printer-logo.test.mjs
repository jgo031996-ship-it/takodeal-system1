import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {logoModeForPaper,printerLogoDimensions,encodePrinterLogo,loadPrinterLogo} from '../Takodeal-POS/printer-logo.js';

const rgba=(width,height,black=[])=>{
    const pixels=new Uint8ClampedArray(width*height*4);pixels.fill(255);
    for(const [x,y] of black){const at=(y*width+x)*4;pixels[at]=pixels[at+1]=pixels[at+2]=0;}return pixels;
};
const sorted=points=>[...points].sort();
// Independent format reader: header declarations, not byte searching, determine
// command boundaries. Tests then compare decoded ink to known source positions.
function decodeCompatible(bytes){
    assert.deepEqual([...bytes.slice(0,6)],[27,97,1,27,51,24]);
    const black=new Set(),ends=[];let at=6,top=0;
    while(at<bytes.length-5){
        assert.deepEqual([...bytes.slice(at,at+3)],[27,42,33]);const width=bytes[at+3]+bytes[at+4]*256;at+=5;
        for(let x=0;x<width;x++)for(let group=0;group<3;group++){
            const value=bytes[at++];for(let bit=0;bit<8;bit++)if(value&(128>>bit))black.add(`${x},${top+group*8+bit}`);
        }
        assert.equal(bytes[at++],10);ends.push(at);top+=24;
    }
    assert.deepEqual([...bytes.slice(at)],[27,50,27,97,0]);return {black,ends,feedRows:top};
}
function decodeRaster(bytes){
    assert.deepEqual([...bytes.slice(0,3)],[27,97,1]);const black=new Set(),progress=[];let at=3;
    assert.deepEqual([...bytes.slice(at,at+4)],[29,118,48,0]);
    const widthBytes=bytes[at+4]+bytes[at+5]*256,height=bytes[at+6]+bytes[at+7]*256;at+=8;
    assert.ok(widthBytes>0 && height>0);assert.equal(bytes.length,at+widthBytes*height+5,'Exactly one declared raster body is followed by restoration commands.');
    for(let y=0;y<height;y++){
        for(let x=0;x<widthBytes;x++){
            const value=bytes[at++];for(let bit=0;bit<8;bit++)if(value&(128>>bit))black.add(`${x*8+bit},${y}`);
        }
        if((y+1)%16===0 || y===height-1)progress.push(at);
    }
    assert.deepEqual([...bytes.slice(at)],[27,50,27,97,0]);return {black,ends:[at],progress,rows:[height],feedRows:height,widthBytes};
}

test('58mm defaults to compatible 24-dot graphics; explicit modes never silently switch',()=>{
    assert.equal(logoModeForPaper(undefined,'58mm'),'esc-star24');assert.equal(logoModeForPaper(undefined,'80mm'),'raster');
    assert.equal(logoModeForPaper('compatible','80mm'),'esc-star24');assert.equal(logoModeForPaper('esc-star24'),'esc-star24');assert.equal(logoModeForPaper('raster'),'raster');assert.equal(logoModeForPaper('none'),'none');
    assert.throws(()=>logoModeForPaper('guess'),/Choose Compatible/);
});
test('logo dimensions use independent controls and enforce mode-specific paper bounds',()=>{
    assert.deepEqual(printerLogoDimensions({width:100,height:100}),{width:160,height:160});
    assert.deepEqual(printerLogoDimensions({width:400,height:100}),{width:160,height:40});
    assert.deepEqual(printerLogoDimensions({width:100,height:100,scaleWidth:1.5}),{width:240,height:160});
    assert.deepEqual(printerLogoDimensions({width:100,height:100,scaleHeight:1.5}),{width:160,height:240});
    assert.deepEqual(printerLogoDimensions({width:100,height:100,scaleWidth:3}),{width:320,height:107});
    assert.deepEqual(printerLogoDimensions({width:100,height:100,scaleHeight:2}),{width:160,height:320});
    assert.deepEqual(printerLogoDimensions({width:100,height:100,scaleWidth:1.5,scaleHeight:1.5}),{width:240,height:240});
    assert.deepEqual(printerLogoDimensions({width:100,height:100,scaleWidth:2,scaleHeight:2}),{width:320,height:320});
    assert.deepEqual(printerLogoDimensions({width:100,height:100,scaleWidth:1.5,scaleHeight:1.5,mode:'raster'}),{width:192,height:192});
    assert.deepEqual(printerLogoDimensions({width:100,height:200,scaleWidth:1.5,scaleHeight:1.5}),{width:192,height:384});
    assert.deepEqual(printerLogoDimensions({width:1,height:5000}),{width:8,height:240});
    assert.deepEqual(printerLogoDimensions({width:1,height:5000,scaleWidth:.5,scaleHeight:.5}),{width:8,height:240});
    assert.deepEqual(printerLogoDimensions({width:1,height:5000,scaleWidth:1.01}),{width:8,height:384});
    assert.deepEqual(printerLogoDimensions({width:1,height:5000,scaleHeight:1.01}),{width:8,height:384});
    assert.deepEqual(printerLogoDimensions({width:1,height:5000,scaleWidth:2,mode:'raster'}),{width:8,height:240});
    assert.deepEqual(printerLogoDimensions({width:100,height:100,paperSize:'80mm'}),{width:320,height:320});
    for(const [width,height] of [[1,5000],[5000,1],[100,900],[900,100],[Number.MIN_VALUE,Number.MAX_VALUE],[Number.MAX_VALUE,Number.MIN_VALUE]])for(const paperSize of ['58mm','80mm'])for(const mode of ['compatible','raster']){
        const size=printerLogoDimensions({width,height,scaleWidth:3,scaleHeight:3,paperSize,mode});
        const maxWidth=paperSize==='80mm'?576:mode==='compatible'?320:192,maxHeight=paperSize==='80mm'?480:mode==='compatible'?384:240;
        assert.equal(size.width%8,0);assert.ok(size.width<=maxWidth);assert.ok(size.height<=maxHeight);assert.ok(Number.isFinite(size.width)&&Number.isFinite(size.height)&&size.width>0&&size.height>0);
    }
    for(const width of [0,-1,Infinity,NaN])assert.throws(()=>printerLogoDimensions({width,height:20}),/dimensions/);
});

test('equal scale increases preserve source shape and cannot make a compatible or raster logo narrower',()=>{
    for(const [width,height] of [[100,100],[100,200],[200,100],[300,400],[1000,1501],[1600,3426]])for(const paperSize of ['58mm','80mm'])for(const mode of ['compatible','raster']){
        let previous={width:0,height:0};
        for(const scale of [.25,.5,.75,.99,1,1.001,1.125,1.21,1.212,1.5,1.75,2,2.5,3]){
            const size=printerLogoDimensions({width,height,scaleWidth:scale,scaleHeight:scale,paperSize,mode});
            assert.ok(size.width>=previous.width,`Width must not shrink at ${scale}x.`);assert.ok(size.height>=previous.height,`Height must not shrink at ${scale}x.`);
            assert.ok(Math.abs(size.height-size.width*height/width)<=.5,'Equal scales preserve aspect within one rounded pixel.');previous=size;
        }
    }
});

test('normal 1x compatible packets retain released dimensions and exact bytes for landscape, portrait and extreme aspects',()=>{
    // These dimensions, lengths and hashes were captured from the released
    // pre-refinement module, with only the two corner pixels set to black.
    const released=[
        [100,100,'58mm',160,160,3413,'38c095bd06aca1c512b48a57373c4162250023998f8afea38a694d830b69c6a5'],
        [400,100,'58mm',160,40,983,'a970fdcb2dc3acdd4a354094aed288b491969d0fa67fa151cd212f8d3aebd15f'],
        [100,200,'58mm',120,240,3671,'eb3fdd0ffccb8d938579dc1e2d257d83006c189cf060d5fed47fe93d9033aaa1'],
        [100,900,'58mm',24,216,713,'bef0ed73984a1a3ec61828a9572aafa8b2813ba38be293945f3703f1c8deffcc'],
        [1,5000,'58mm',8,240,311,'2ada8d701f0b3e4a1f123afb8ac9ec973478f0bb202fcd22c7e50f2117a16855'],
        [1000,1501,'58mm',160,240,4871,'dedf4443098e1100ded1db14f913c4fe49797c80add50795fbb63e39e8aea2d8'],
        [1000,1504,'58mm',152,229,4631,'9c42e9b2d231d52d357fa59aba76dc29235daf7e71719012e3c9bcf1bf9ccbaf'],
        [5000,1,'58mm',160,1,497,'df7c56c64edf05485538762fd78938f6f128c214913ea41e8dac207111a55281'],
        [100,200,'80mm',240,480,14531,'57174464b66bf74b60692d582c5466af1bd8c603368569fd8e301f922c8e9bd1'],
    ];
    for(const [width,height,paperSize,targetWidth,targetHeight,length,hash] of released){
        const size=printerLogoDimensions({width,height,paperSize,mode:'compatible'}),points=[[0,0],[targetWidth-1,targetHeight-1]];
        assert.deepEqual(size,{width:targetWidth,height:targetHeight});
        const bytes=encodePrinterLogo({...size,pixels:rgba(size.width,size.height,points),mode:'compatible'});
        assert.equal(bytes.length,length);assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
        assert.deepEqual(sorted(decodeCompatible(bytes).black),sorted(points.map(([x,y])=>`${x},${y}`)));
    }
});
test('compatible encoder has exact 24-dot column order and pads only the final band with white',()=>{
    const points=[[0,0],[4,7],[2,8],[1,23],[3,24],[4,26]],bytes=encodePrinterLogo({width:5,height:27,pixels:rgba(5,27,points),mode:'compatible'});
    assert.deepEqual([...bytes.slice(6,11)],[27,42,33,5,0]);
    assert.deepEqual([...bytes.slice(11,26)],[128,0,0,0,0,1,0,128,0,0,0,0,1,0,0]);
    const decoded=decodeCompatible(bytes);assert.deepEqual(sorted(decoded.black),sorted(points.map(([x,y])=>`${x},${y}`)));assert.equal(decoded.feedRows,48);
    assert.deepEqual(bytes.pauseAfterBytes,decoded.ends);assert.deepEqual(decoded.ends,[27,48]);
});
test('raster encoder declares one full-height body with exact row order, odd-width padding and progress pauses',()=>{
    const points=[[0,0],[8,0],[3,15],[4,16],[7,31],[8,32]],bytes=encodePrinterLogo({width:9,height:33,pixels:rgba(9,33,points),mode:'raster'}),decoded=decodeRaster(bytes);
    assert.deepEqual([...bytes.slice(3,11)],[29,118,48,0,2,0,33,0]);assert.deepEqual([...bytes.slice(11,13)],[128,128]);
    assert.deepEqual(sorted(decoded.black),sorted(points.map(([x,y])=>`${x},${y}`)));assert.deepEqual(decoded.rows,[33]);assert.equal(decoded.feedRows,33);
    assert.deepEqual(bytes.pauseAfterBytes,[43,75,77]);assert.deepEqual(bytes.pauseAfterBytes,decoded.progress);assert.deepEqual(decoded.ends,[77]);
});
test('transparent and partial-alpha dark pixels composite against white, and threshold128 is exact',()=>{
    const pixels=Uint8ClampedArray.from([0,0,0,0, 0,0,0,127, 0,0,0,128, 127,127,127,255, 128,128,128,255, 255,255,255,255]);
    const decoded=decodeRaster(encodePrinterLogo({width:6,height:1,pixels,mode:'raster'}));assert.deepEqual(sorted(decoded.black),['2,0','3,0']);
    assert.deepEqual([...pixels],[0,0,0,0,0,0,0,127,0,0,0,128,127,127,127,255,128,128,128,255,255,255,255,255]);
});
test('encoded image data that resembles commands never creates a spurious pacing boundary',()=>{
    const rows=[27,42,33,10,29,118,48,0],black=[];
    rows.forEach((value,y)=>{for(let bit=0;bit<8;bit++)if(value&(128>>bit))black.push([bit,y]);});
    const bytes=encodePrinterLogo({width:8,height:8,pixels:rgba(8,8,black),mode:'raster'});assert.deepEqual([...bytes.slice(11,19)],rows);assert.deepEqual(bytes.pauseAfterBytes,[19]);
    assert.equal(Object.getOwnPropertyDescriptor(bytes,'pauseAfterBytes').enumerable,false);assert.equal(Object.isFrozen(bytes.pauseAfterBytes),true);
    assert.equal(Object.keys(bytes).includes('pauseAfterBytes'),false);assert.deepEqual(decodeRaster(bytes).ends,[19]);
});
test('compatible bands and full raster bodies declare exact bytes with bounded image-progress intervals',()=>{
    for(const mode of ['compatible','raster']){
        const size=printerLogoDimensions({width:100,height:100,scaleWidth:3,scaleHeight:3,mode}),bytes=encodePrinterLogo({...size,pixels:rgba(size.width,size.height),mode});
        const decoded=mode==='compatible'?decodeCompatible(bytes):decodeRaster(bytes);assert.equal(decoded.black.size,0);assert.deepEqual(bytes.pauseAfterBytes,mode==='compatible'?decoded.ends:decoded.progress);
        const maximum=mode==='compatible'?320*3+6:8+Math.ceil(size.width/8)*16;
        assert.ok(bytes.pauseAfterBytes.every((end,i)=>end-(i?bytes.pauseAfterBytes[i-1]:mode==='compatible'?6:3)<=maximum));
        assert.equal(bytes.pauseAfterBytes.at(-1),bytes.length-5);
    }
});

test('control-like pixel bytes remain inside one raster body and never create commands or false progress markers',()=>{
    const pattern=[29,118,48,0,1,0,16,0,27,42,33,10,27,112,0,25,150,29,86,65,16],rows=Array.from({length:40},(_,y)=>pattern[y%pattern.length]),black=[];
    rows.forEach((value,y)=>{for(let bit=0;bit<8;bit++)if(value&(128>>bit))black.push([bit,y]);});
    const bytes=encodePrinterLogo({width:8,height:40,pixels:rgba(8,40,black),mode:'raster'}),decoded=decodeRaster(bytes);
    assert.deepEqual([...bytes.slice(3,11)],[29,118,48,0,1,0,40,0]);assert.deepEqual([...bytes.slice(11,51)],rows);
    assert.deepEqual(bytes.pauseAfterBytes,[27,43,51]);assert.deepEqual(decoded.ends,[51]);assert.deepEqual(decoded.rows,[40]);
    assert.deepEqual(sorted(decoded.black),sorted(black.map(([x,y])=>`${x},${y}`)));
});
test('invalid input cannot emit partial graphics, drawer or cut commands; text-only mode emits no commands',()=>{
    const valid={width:1,height:1,pixels:rgba(1,1)};
    for(const changes of [{width:0},{width:577},{height:481},{height:1.5},{pixels:new Uint8Array(3)},{pixels:[0,0,0,256]},{threshold:-1},{threshold:256}])assert.throws(()=>encodePrinterLogo({...valid,...changes}));
    const none=encodePrinterLogo({mode:'none'});assert.equal(none.length,0);assert.deepEqual(none.pauseAfterBytes,[]);
    const bytes=encodePrinterLogo({...valid});assert.deepEqual([...bytes.slice(0,6)],[27,97,1,27,51,24]);assert.deepEqual([...bytes.slice(-5)],[27,50,27,97,0]);
});

function loaderFixture({width=100,height=100,brokenContext=false,tainted=false,cleanupThrows=false}={}){
    const timers=new Map(),calls=[],canvases=[];let next=0,source;
    const image={naturalWidth:width,naturalHeight:height,width,height,set src(value){source=value;},get src(){return source;}};
    const options={imageFactory:()=>image,canvasFactory:()=>{const canvas={width:0,height:0,getContext(){if(brokenContext)return null;return {set fillStyle(value){calls.push(['fill',value]);},fillRect:(...args)=>calls.push(['white',...args]),drawImage:(...args)=>calls.push(['draw',...args]),getImageData(){if(tainted)throw Error('Canvas access refused');return {data:rgba(canvas.width,canvas.height,[[0,0]])};}};}};canvases.push(canvas);return canvas;},
        schedule:(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;},cancel:id=>{timers.delete(id);if(cleanupThrows)throw Error('Custom timer failure');}};
    return {options,image,timers,calls,canvases,load:(extra={})=>loadPrinterLogo('data:image/png;base64,synthetic-only',{...options,...extra})};
}
test('browser loader prepares a white canvas at conservative dimensions and returns the actual compatible packet',async()=>{
    const f=loaderFixture(),loading=f.load();assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,8000);f.image.onload();const bytes=await loading;
    assert.deepEqual([f.canvases[0].width,f.canvases[0].height],[160,160]);assert.deepEqual(f.calls[0],['fill','#ffffff']);assert.equal(f.calls[1][0],'white');assert.equal(f.calls[2][0],'draw');
    assert.deepEqual(sorted(decodeCompatible(bytes).black),['0,0']);assert.equal(f.timers.size,0);assert.equal(f.image.onload,null);assert.equal(f.image.onerror,null);
});
test('broken image, context, CORS and zero-dimension failures are explicit errors rather than silent logo removal',async()=>{
    const broken=loaderFixture(),failed=broken.load();broken.image.onerror();await assert.rejects(failed,/could not be loaded/);assert.equal(broken.timers.size,0);
    for(const settings of [{brokenContext:true},{tainted:true},{width:0},{height:0}]){
        const f=loaderFixture(settings),loading=f.load();f.image.onload();await assert.rejects(loading,/could not be prepared/);assert.equal(f.timers.size,0);
    }
});
test('8-second loading timeout refuses a late image and cannot allocate or return a stale print packet',async()=>{
    const f=loaderFixture(),loading=f.load(),late=f.image.onload,timer=[...f.timers.values()][0];timer.fn();await assert.rejects(loading,/within 8 seconds/);
    late();assert.equal(f.canvases.length,0);assert.equal(f.image.onload,null);assert.equal(f.timers.size,0);
});
test('load completion cannot hang if a custom timer cleanup throws',async()=>{
    const f=loaderFixture({cleanupThrows:true}),loading=f.load();f.image.onload();const bytes=await loading;assert.equal(decodeCompatible(bytes).black.size,1);
});
test('text-only mode never loads an image or schedules a timer and invalid modes fail before loading',async()=>{
    const f=loaderFixture();const bytes=await f.load({mode:'none'});assert.equal(bytes.length,0);assert.equal(f.image.src,undefined);assert.equal(f.timers.size,0);
    await assert.rejects(f.load({mode:'guess'}),/Choose Compatible/);await assert.rejects(f.load({timeoutMs:9000}),/at most 8 seconds/);assert.equal(f.timers.size,0);
});
test('legacy remote images request anonymous canvas access and timer APIs keep their native global receiver',async()=>{
    const f=loaderFixture(),loading=loadPrinterLogo('https://example.invalid/synthetic-logo.png',f.options);assert.equal(f.image.crossOrigin,'anonymous');f.image.onload();await loading;
    const savedSet=globalThis.setTimeout,savedClear=globalThis.clearTimeout;let cleared=false;
    try{
        globalThis.setTimeout=function(){assert.equal(this,globalThis);return 123;};globalThis.clearTimeout=function(id){assert.equal(this,globalThis);assert.equal(id,123);cleared=true;};
        const local=loaderFixture();const promise=loadPrinterLogo('data:image/png;base64,synthetic-only',{imageFactory:local.options.imageFactory,canvasFactory:local.options.canvasFactory});local.image.onload();await promise;assert.equal(cleared,true);
    }finally{globalThis.setTimeout=savedSet;globalThis.clearTimeout=savedClear;}
});
