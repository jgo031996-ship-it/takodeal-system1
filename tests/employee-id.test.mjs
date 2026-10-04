import test from 'node:test';
import assert from 'node:assert/strict';
import {employeeIDDetails,employeeIDFilename,generateEmployeeID} from '../takodeal-manager/employee-id.js';
const values={empFullName:'Alex Rivera',empRole:'Service Crew',empBranchAssign:'Main Office',empDateHired:'2026-02-25',profEmpId:'TKDL-2026-0001',empEmergencyName:'Sample Contact',empEmergencyPhone:'Sample phone',profBloodType:''};
test('ID uses profile fields with a timezone-stable hire date and no invented branch suffix',()=>{
    const data=employeeIDDetails(id=>values[id]);assert.equal(data.hired,'Feb 25, 2026');
    assert.equal(data.branch,'Main Office');assert.equal(data.name,'Alex Rivera');assert.equal(data.initials,'AR');assert.equal(data.blood,'Not recorded');
    assert.equal(employeeIDFilename('Alex / Rivera:*'),'ID_Card_Alex_Rivera.png');
    for(const id of ['', 'Pending Generation...', 'undefined', 'null'])assert.throws(()=>employeeIDDetails(key=>key==='profEmpId'?id:values[key]),/Save the employee/);
});
function fixture({photo='',ImageClass=class{},renderError=false}={}) {
    const fields=new Map(),downloads=[],calls=[],dialogs=[];
    const node=id=>fields.get(id)||fields.set(id,{id,style:{},dataset:{},hidden:false,clientWidth:100,scrollWidth:100,clientHeight:100,scrollHeight:100,
        textContent:'',removeAttribute(name){delete this[name];},getAttribute(name){return this[name]||null;}}).get(id);
    node('masterProfilePic').src=photo;
    const d={getElementById:node,querySelectorAll:selector=>{
        const id=selector.match(/id="(.*?)"/)[1];return [{value:'stale hidden input'},{value:values[id]}];},
        fonts:{ready:Promise.resolve()},createElement:tag=>tag==='a'?{click(){downloads.push({name:this.download,url:this.href});}}:{}};
    const dialog={fire:async(...args)=>dialogs.push(args),close(){},showLoading(){}};
    const render=async(element,options)=>{calls.push(options);if(renderError)throw new Error('Export failed');return {toDataURL:()=> 'data:image/png;base64,sample'};};
    return {fields,downloads,calls,dialogs,options:{document:d,dialog,render,ImageClass,timeoutMs:10}};
}
test('actual generator downloads both sides once at high resolution, using literal employee text and initials when no photo exists',async()=>{
    const h=fixture();await generateEmployeeID(h.options);
    assert.equal(h.fields.get('idFrontName').textContent,'Alex Rivera');assert.equal(h.fields.get('idFrontNo').textContent,values.profEmpId);
    assert.equal(h.fields.get('idFrontInitials').textContent,'AR');assert.equal(h.fields.get('idFrontPic').hidden,true);
    assert.equal(h.downloads.length,1);assert.equal(h.downloads[0].name,'ID_Card_Alex_Rivera.png');
    assert.equal(h.calls[0].scale,3);assert.equal(h.calls[0].width,1012);assert.equal(h.calls[0].height,638);
    assert.equal(h.fields.get('idCardTemplate').style.display,'none');assert.equal(h.fields.get('idCardTemplate').dataset.generating,undefined);
});
test('a blocked photo uses only its original source and fails clearly without downloading an inaccurate card',async()=>{
    const sources=[];class ImageMock {set src(value){sources.push(value);queueMicrotask(()=>this.onerror());}}
    const h=fixture({photo:'https://employee-storage.example.test/photo.png',ImageClass:ImageMock});await generateEmployeeID(h.options);
    assert.deepEqual(sources,['https://employee-storage.example.test/photo.png']);assert.equal(h.downloads.length,0);
    assert.equal(h.dialogs.at(-1)[0],'ID could not be generated');assert.match(h.dialogs.at(-1)[1],/photo could not load/);
    assert.equal(h.fields.get('idCardTemplate').style.display,'none');
});
test('export failure cleans up and a second click cannot start a competing ID export',async()=>{
    const failed=fixture({renderError:true});await generateEmployeeID(failed.options);assert.equal(failed.downloads.length,0);
    assert.equal(failed.fields.get('idCardTemplate').dataset.generating,undefined);
    const h=fixture();let complete;h.options.render=()=>new Promise(resolve=>complete=resolve);
    const first=generateEmployeeID(h.options);await new Promise(resolve=>setImmediate(resolve));
    await generateEmployeeID(h.options);complete({toDataURL:()=> 'sample'});await first;
    assert.equal(h.downloads.length,1);
});
