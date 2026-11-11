import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {renderStaffStartupInline} from '../tools/build-staff-startup-inline.mjs';
const root=new URL('../takodeal-staff/',import.meta.url),runtime=readFileSync(new URL('staff-startup.js',root),'utf8'),html=readFileSync(new URL('index.html',root),'utf8');
const extract=page=>{const start=page.indexOf('    <!-- BEGIN GENERATED STAFF STARTUP -->'),end=page.indexOf('    <!-- END GENERATED STAFF STARTUP -->',start);assert.ok(start>=0&&end>start);const block=page.slice(start,end),match=/<script>([\s\S]*)<\/script>/.exec(block);assert.ok(match);return{start,end,code:match[1]};};
test('exact startup bytes execute inline after charset and before every stylesheet/external dependency',()=>{
 const inline=extract(html);assert.equal(inline.code,runtime);assert.ok(html.indexOf('<meta charset="UTF-8">')<inline.start);assert.doesNotMatch(html.slice(0,inline.start),/<link\b|<style\b|<script\b/i);assert.doesNotMatch(html,/<script[^>]+src=["']staff-startup\.js/);assert.equal(renderStaffStartupInline(html,runtime),html);
});
test('inline generator fails closed on script terminators, ambiguous boundaries and dependency-before-charset placement',()=>{
 for(const text of ['</script>','</ScRiPt anything','</script'])assert.throws(()=>renderStaffStartupInline(html,runtime+'\n/* '+text+' */'),/script terminator/);
 assert.throws(()=>renderStaffStartupInline(html.replace('<!-- END GENERATED STAFF STARTUP -->',''),runtime),/boundary/);assert.throws(()=>renderStaffStartupInline(html+'\n    <!-- BEGIN GENERATED STAFF STARTUP -->',runtime),/boundary/);
 const before='<html><head>\n<link rel="stylesheet" href="held.css">\n    <meta charset="UTF-8">\n</head></html>';assert.throws(()=>renderStaffStartupInline(before,runtime),/before all dependencies/);
});
test('the exact early inline runtime installs recovery while parsing with no body, CSS completion, external scripts or app module',()=>{
 const events=new Map(),timers=new Map(),calls=[];const d={readyState:'loading',body:null,getElementById:()=>null,querySelectorAll:()=>[],addEventListener:(type,fn)=>events.set(type,fn)};
 const w={location:{href:'https://staff.example.invalid/',origin:'https://staff.example.invalid'},setTimeout:(fn,ms)=>{timers.set(ms,fn);return ms;},clearTimeout:ms=>timers.delete(ms),addEventListener:(type,fn)=>events.set('window:'+type,fn)};
 for(const key of ['fetch','localStorage','indexedDB','auth','firebase','caches'])Object.defineProperty(w,key,{get(){calls.push(key);throw Error('No dependency or saved data is needed before CSS');}});
 vm.runInNewContext(extract(html).code,{window:w,document:d,navigator:{},Symbol,URL,Promise,Array,Object,String,Error});assert.equal(typeof w.forceUpdateApp,'function');assert.equal(typeof w.staffStartup.ready,'function');assert.equal(typeof w.requestDeviceAccess,'function');assert.ok(timers.has(15000));assert.ok(timers.has(30000));assert.equal(d.body,null);assert.deepEqual(calls,[]);
});
