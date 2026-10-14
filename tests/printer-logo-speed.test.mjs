import test from 'node:test';
import assert from 'node:assert/strict';
import {encodePrinterLogo,createCachedPrinterLogoLoader} from '../Takodeal-POS/printer-logo.js';
import {createPrinterWriter} from '../Takodeal-POS/printer-connection.js';
function image(width,height,points){const pixels=new Uint8Array(width*height*4);pixels.fill(255);for(const [x,y] of points){const at=(y*width+x)*4;pixels[at]=pixels[at+1]=pixels[at+2]=0;}return {width,height,pixels};}
// Read declared column lengths; control-looking image bytes are never scanned as commands.
function decode(bytes){let offset=6,top=0;const ink=[];assert.deepEqual([...bytes.slice(0,6)],[27,97,1,27,51,24]);
    while(offset<bytes.length-5){if(bytes[offset]===10){top+=24;offset++;continue;}assert.deepEqual([...bytes.slice(offset,offset+3)],[27,42,33]);const width=bytes[offset+3]+bytes[offset+4]*256;offset+=5;for(let x=0;x<width;x++)for(let group=0;group<3;group++){const value=bytes[offset++];for(let bit=0;bit<8;bit++)if(value&(128>>bit))ink.push([x,top+group*8+bit]);}assert.equal(bytes[offset++],10);top+=24;}
    assert.deepEqual([...bytes.slice(offset)],[27,50,27,97,0]);return {ink,feed:top};}
test('blank compatible bands use much less data with identical ink positions, paper advance and restoration commands',()=>{
    for(const height of [1,24,25,160,240,384]){const input=image(160,height,[[0,0],[159,height-1]]),normal=encodePrinterLogo(input),compact=encodePrinterLogo({...input,omitBlankBands:true});assert.deepEqual(decode(compact),decode(normal));assert.ok(compact.length<=normal.length);}
    const input=image(192,240,[[0,0],[191,239]]),normal=encodePrinterLogo(input),compact=encodePrinterLogo({...input,omitBlankBands:true});assert.ok(compact.length<normal.length*.25);assert.equal(compact.pauseAfterBytes.length,2);
});
test('solid compatible artwork and raster logos retain their exact existing command bytes',()=>{
    const solid=image(160,48,[]);for(let at=0;at<solid.pixels.length;at+=4)solid.pixels[at]=solid.pixels[at+1]=solid.pixels[at+2]=0;
    for(const mode of ['compatible','raster']){const normal=encodePrinterLogo({...solid,mode}),compact=encodePrinterLogo({...solid,mode,omitBlankBands:true});assert.deepEqual([...compact],[...normal]);assert.deepEqual(compact.pauseAfterBytes,normal.pauseAfterBytes);}
});
test('cached logos coalesce preparation and return independent bytes and pause offsets',async()=>{
    let prepared=0;const loader=createCachedPrinterLogoLoader(async()=>{prepared++;return encodePrinterLogo(image(8,24,[[0,0]]));});
    const [a,b]=await Promise.all([loader('logo-a'),loader('logo-a')]);assert.equal(prepared,1);assert.notEqual(a,b);a[6]=0;
    const c=await loader('logo-a');assert.equal(prepared,1);assert.equal(c[6],27);assert.deepEqual(c.pauseAfterBytes,b.pauseAfterBytes);assert.notEqual(c.pauseAfterBytes,b.pauseAfterBytes);
});
test('logo source, dimensions, paper, mode and threshold changes invalidate preparation; only two logos are retained',async()=>{
    let count=0;const loader=createCachedPrinterLogoLoader(async()=>{count++;return encodePrinterLogo(image(8,24,[]));});
    await loader('a');await loader('a');assert.equal(count,1);
    for(const options of [{scaleWidth:2},{scaleHeight:2},{paperSize:'80mm'},{mode:'raster'},{threshold:150}])await loader('a',options);assert.equal(count,6);
    await loader('b');await loader('c');await loader('a');assert.equal(count,9);
});
test('a failed logo preparation is not cached and can be retried',async()=>{
    let count=0;const loader=createCachedPrinterLogoLoader(async()=>{if(++count===1)throw Error('temporary image failure');return encodePrinterLogo(image(8,24,[]));});
    await assert.rejects(loader('a'),/temporary image failure/);await loader('a');assert.equal(count,2);
});
function transport(ack=true){const chunks=[],waits=[];const character={properties:{write:ack,writeWithoutResponse:!ack},async writeValueWithResponse(data){chunks.push([...data]);},async writeValueWithoutResponse(data){chunks.push([...data]);}};const connections={connect:async()=>character,ready:()=>character,invalidate(){assert.fail('Unexpected connection reset');}};return {chunks,waits,writer:createPrinterWriter(connections,{wait:async ms=>waits.push(ms)})};}
test('acknowledged logo writes remove redundant chunk waits while retaining 20-byte packets and image-band pauses',async()=>{
    const t=transport(),bytes=encodePrinterLogo(image(160,48,[[0,0],[159,47]]));await t.writer.send(bytes,'main',{pauseAfterBytes:bytes.pauseAfterBytes});
    assert.ok(t.chunks.every(chunk=>chunk.length<=20));assert.deepEqual(t.chunks.flat(),[...bytes]);assert.deepEqual(t.waits,[120,120,120]);
});
test('unacknowledged logo endpoints retain 25ms packet pacing, band waits and exact bytes',async()=>{
    const t=transport(false),bytes=encodePrinterLogo(image(8,24,[[0,0]]));await t.writer.send(bytes,'main',{pauseAfterBytes:bytes.pauseAfterBytes});
    assert.deepEqual(t.chunks.flat(),[...bytes]);assert.equal(t.waits.filter(ms=>ms===25).length,t.chunks.length);assert.equal(t.waits.filter(ms=>ms===120).length,2);
});
test('ordinary text and drawer jobs keep their previous acknowledged-write pacing',async()=>{
    const t=transport();await t.writer.send(new Uint8Array(41));assert.deepEqual(t.waits,[5,5,5,120]);assert.equal(t.chunks.length,3);
});
