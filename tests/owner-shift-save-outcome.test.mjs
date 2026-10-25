import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('window.saveShiftConfigChanges = async function()'),source.indexOf('window.saveManualSchedule = async function()'));
function original({readonly=false,saved=false}={}){const statuses=[],w={scheduleMemoryReadOnly:readonly,ManagerUI:{notify:x=>statuses.push(x)},captureTempShiftConfig(){},isBranchAllowed:()=>true,saveToCloud:async()=>saved};vm.runInNewContext(body,{window:w,branchConfig:{},currentSchedule:{},document:{getElementById:id=>id==='ownerScheduleSyncStatus'?{textContent:'HQ confirmation is unavailable; the local draft is preserved.'}:null},setTimeout(){}});return {w,statuses};}
test('actual read-only shift save returns false and cannot be reported as confirmed',async()=>{const f=original({readonly:true});assert.equal(await f.w.saveShiftConfigChanges(),false);assert.match(f.statuses[0],/read-only/);});
test('actual shift save retains the specific confirmation failure instead of blaming shift rules',async()=>{const f=original();await assert.rejects(f.w.saveShiftConfigChanges(),/HQ confirmation is unavailable; the local draft is preserved/);});
test('actual successful shift save returns an explicit confirmed outcome',async()=>{const f=original({saved:true});assert.equal(await f.w.saveShiftConfigChanges(),true);});
test('actual delayed save wrapper never announces success for an explicit false outcome',async()=>{
 const start=source.indexOf('// We use a slight delay to ensure all your original code has loaded'),end=source.indexOf('// 📈 LIFETIME REMITTANCE',start),code=source.slice(start,end),messages=[],button={innerText:'Save shift rules',disabled:false};
 const w={saveShiftConfigChanges:async()=>false,renderTables(){throw Error('No render for an unconfirmed save');}};vm.runInNewContext(code,{window:w,document:{querySelector:()=>button},Swal:{fire:(...args)=>messages.push(args)},setTimeout:fn=>fn(),Promise,console});assert.equal(await w.saveShiftConfigChanges(),false);assert.deepEqual(messages,[]);assert.equal(button.disabled,false);
});
