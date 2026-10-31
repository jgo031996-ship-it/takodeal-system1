import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('window.saveShiftConfigChanges = async function()'),source.indexOf('window.markScheduleDraftEdited = function()'));
function original({readonly=false,saved=false}={}){const statuses=[],drafts=[],w={scheduleMemoryReadOnly:readonly,ManagerUI:{notify:x=>statuses.push(x)},captureTempShiftConfig(){},markScheduleDraftEdited:()=>drafts.push(true),isBranchAllowed:()=>true,saveToCloud:async()=>saved};vm.runInNewContext(body,{window:w,branchConfig:{},currentSchedule:{},document:{getElementById:id=>id==='ownerScheduleSyncStatus'?{textContent:'HQ confirmation is unavailable; the local draft is preserved.'}:null},setTimeout(){}});return {w,statuses,drafts};}
test('actual read-only shift save returns false and cannot be reported as confirmed',async()=>{const f=original({readonly:true});assert.equal(await f.w.saveShiftConfigChanges(),false);assert.match(f.statuses[0],/read-only/);});
test('applying shift rules only marks a local draft even when no cloud save is available',async()=>{const f=original();assert.equal(await f.w.saveShiftConfigChanges(),true);assert.deepEqual(f.drafts,[true]);});
test('actual shift draft application returns an explicit local outcome',async()=>{const f=original({saved:true});assert.equal(await f.w.saveShiftConfigChanges(),true);});
test('actual delayed save wrapper never announces success for an explicit false outcome',async()=>{
 const start=source.indexOf('// We use a slight delay to ensure all your original code has loaded'),end=source.indexOf('// 📈 LIFETIME REMITTANCE',start),code=source.slice(start,end),messages=[],button={innerText:'Save shift rules',disabled:false};
 const w={saveShiftConfigChanges:async()=>false,renderTables(){throw Error('No render for an unconfirmed save');}};vm.runInNewContext(code,{window:w,document:{querySelector:()=>button},Swal:{fire:(...args)=>messages.push(args)},setTimeout:fn=>fn(),Promise,console});assert.equal(await w.saveShiftConfigChanges(),false);assert.deepEqual(messages,[]);assert.equal(button.disabled,false);
});
