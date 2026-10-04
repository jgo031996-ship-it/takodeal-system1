import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrinterConnections,createPrinterWriter} from '../Takodeal-POS/printer-connection.js';

function setup({remembered=true,canRecall=true}={}) {
    const values=new Map(remembered?[['takodeal_printer_main_id','printer-1']]:[]);
    const timers=new Map(), events={}, states=[], chunks=[];
    let timerId=0,connects=0,discovery=0,choosers=0,failConnect=false,failWrite=false;
    const device={id:'printer-1',name:'Receipt printer',addEventListener(name,handler){(events[name]??=[]).push(handler);}};
    const service={device,async getCharacteristics(){discovery++;return [character];}};
    const character={service,properties:{writeWithoutResponse:true},async writeValueWithoutResponse(chunk){if(failWrite)throw Error('disconnected');chunks.push([...chunk]);}};
    device.gatt={connected:false,async connect(){connects++;if(failConnect)throw Error('printer asleep');this.connected=true;return this;},async getPrimaryServices(){return [service];}};
    const bluetooth={async requestDevice(){choosers++;return device;},...(canRecall?{async getDevices(){return [device];}}:{})};
    const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
    const connections=createPrinterConnections({bluetooth,storage,onState:(role,state)=>states.push({role,...state}),schedule:fn=>{const id=++timerId;timers.set(id,fn);return id;},cancel:id=>timers.delete(id)});
    return {connections,device,character,chunks,events,states,timers,values,get connects(){return connects;},get choosers(){return choosers;},get discovery(){return discovery;},set failConnect(value){failConnect=value;},set failWrite(value){failWrite=value;},async disconnect(){device.gatt.connected=false;for(const fn of events.gattserverdisconnected||[])fn();},async tick(){const [id,fn]=timers.entries().next().value;timers.delete(id);await fn();await new Promise(resolve=>setImmediate(resolve));}};
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
    await writer.send(new Uint8Array(250));assert.equal(app.connects,2);assert.deepEqual(app.chunks.map(chunk=>chunk.length),[100,100,50]);
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
    await assert.rejects(writer.send(new Uint8Array(250)),error=>error.bytesWritten===100);
    assert.equal(app.chunks.length,1);app.character.writeValueWithoutResponse=async chunk=>app.chunks.push([...chunk]);
    await writer.send([7]);assert.equal(app.chunks.length,2);assert.deepEqual(app.chunks[1],[7]);
});
test('printer pause cancels background retry until the page is active again',async()=>{
    const app=setup();app.failConnect=true;await app.connections.reconnect();app.connections.pause();assert.equal(app.timers.size,0);
    app.failConnect=false;await app.connections.reconnect();assert.equal(app.connections.snapshot('main').connected,true);
});
