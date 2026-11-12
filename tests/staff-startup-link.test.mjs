// Native link-only regression: no app evaluation, SDK calls or real data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {installStaffAppUpdate} from '../takodeal-staff/staff-phone.js';

const root=fileURLToPath(new URL('../',import.meta.url));
let captured;
function moduleResults(){
 if(captured)return captured;
 const child=String.raw`
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const root=process.argv[1],dir=resolve(root,'takodeal-staff'),hash=source=>createHash('sha256').update(source).digest('hex'),read=file=>readFileSync(resolve(dir,file),'utf8');
globalThis.fetch=()=>{throw Error('Network is forbidden in this link-only check');};
const historical=(commit,file,pin)=>{const source=execFileSync('git',['show',commit+':takodeal-staff/'+file],{cwd:root,windowsHide:true,encoding:'utf8'});if(hash(source)!==pin)throw Error('Historical fixture bytes changed: '+file);return source;};
const oldModel=historical('a3c76d784cc492e9dcbc0e74348e3fd2baa2546a','staff-document-model.js','96f03e0eaa725187ae5cfbd535187aa8ca8c7b23034c40f068d1bc0c4c58ac62');
const oldPhone=historical('626ad566df3b28299b687d518fb006f248b42623','staff-phone.js','c0c7752a0e05a1c0957246dffa8d3d344fc0294805d82ea8e4461660e80751d9');
const remoteNames=new Set(['default']);
for(const source of readdirSync(dir).filter(file=>file.endsWith('.js')).map(read))for(const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]https:\/\/[^'"]+['"]/g))for(const binding of match[1].split(',')){const name=binding.trim().split(/\s+as\s+/)[0];if(/^[$\w]+$/.test(name))remoteNames.add(name);}
async function link(entry,overrides={}){
 const context=vm.createContext({}),modules=new Map();
 const load=id=>{if(modules.has(id))return modules.get(id);const module=id.startsWith('https:')?new vm.SyntheticModule([...remoteNames],function(){},{context,identifier:id}):new vm.SourceTextModule(overrides[id]??read(id),{context,identifier:id});modules.set(id,module);return module;};
 const entryModule=load(entry);let failure;
 try{await entryModule.link(specifier=>load(specifier.startsWith('./')?specifier.slice(2):specifier));}catch(error){failure={name:error.name,message:error.message};}
 return{linked:!failure,failure,localModules:[...modules.keys()].filter(id=>!id.startsWith('https:')).length,evaluated:[...modules.values()].some(module=>module.status==='evaluated'),registrationInstalled:typeof context.requestDeviceAccess==='function'};
}
const fresh=await link('app.js'),mixedModel=await link('app.js',{'staff-document-model.js':oldModel});
const updater='import {installStaffAppUpdate} from "./staff-phone.js"; installStaffAppUpdate();',mixedOldUpdater=await link('__old_inline_updater__.js',{'__old_inline_updater__.js':updater,'staff-phone.js':oldPhone});
process.stdout.write(JSON.stringify({fresh,mixedModel,mixedOldUpdater}));`;
 captured=JSON.parse(execFileSync(process.execPath,['--experimental-vm-modules','--no-warnings','--input-type=module','-e',child,root],{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:2*1024*1024,timeout:10000}));
 return captured;
}

test('the current complete 78-module Staff graph links without app evaluation or external SDK execution',()=>{
 const {fresh}=moduleResults();assert.equal(fresh.linked,true,fresh.failure?.message);assert.equal(fresh.localModules,78);assert.equal(fresh.evaluated,false);assert.equal(fresh.registrationInstalled,false);
});

test('exact previous a3 cached document model breaks actual current app linking before any registration handler runs',()=>{
 const {mixedModel}=moduleResults();assert.equal(mixedModel.linked,false);assert.equal(mixedModel.failure.name,'SyntaxError');assert.match(mixedModel.failure.message,/staff-document-model\.js.*SUPPORTED_DOCUMENT_GROUPS/);assert.equal(mixedModel.evaluated,false);assert.equal(mixedModel.registrationInstalled,false);
});

test('exact older cached phone module can also break the previous module-based recovery updater before it runs',()=>{
 const {mixedOldUpdater}=moduleResults();assert.equal(mixedOldUpdater.linked,false);assert.equal(mixedOldUpdater.failure.name,'SyntaxError');assert.match(mixedOldUpdater.failure.message,/staff-phone\.js.*installStaffAppUpdate/);assert.equal(mixedOldUpdater.evaluated,false);assert.equal(mixedOldUpdater.registrationInstalled,false);
});

test('actual classic recovery survives a failed main-module graph without touching Auth, saved device data or outboxes',async()=>{
 assert.equal(moduleResults().mixedModel.linked,false);
 const source=readFileSync(new URL('../takodeal-staff/staff-startup.js',import.meta.url),'utf8'),html=readFileSync(new URL('../takodeal-staff/index.html',import.meta.url),'utf8'),app=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\bimport\s*(?:\(|\{|['"])/);const marker=html.indexOf('<!-- BEGIN GENERATED STAFF STARTUP -->'),inline=html.indexOf('<script>',marker),end=html.indexOf('</script>',inline),firstLink=html.indexOf('<link');assert.ok(marker>=0&&inline>marker&&end>inline&&firstLink>end,'Exact classic inline payload must exist before every blocking resource');assert.equal(html.slice(inline+'<script>'.length,end),source);assert.doesNotMatch(html,/<script defer src="staff-startup\.js/);assert.ok(app.trim().endsWith('window.staffStartup?.ready();'));
 const elements=[],listeners=new Map(),windowListeners=new Map(),timers=new Map(),touches=[];
 const element=(tag,id='')=>{const attributes=new Map(),events=new Map(),node={tagName:tag.toUpperCase(),id,style:{},hidden:false,textContent:'',value:'',files:[],children:[],disabled:false,setAttribute(name,value){attributes.set(name,String(value));},getAttribute:name=>attributes.get(name)??null,hasAttribute:name=>attributes.has(name),removeAttribute:name=>attributes.delete(name),appendChild(child){child.parentElement=node;node.children.push(child);},addEventListener(type,fn){events.set(type,fn);}};elements.push(node);return node;};
 const status=element('p');status.setAttribute('data-staff-update-status','');const update=element('button');update.setAttribute('data-staff-update','');const registration=element('p','deviceRegistrationStatus'),personal=element('button','usePersonalSetupCode');
 const d={body:element('body'),createElement:tag=>element(tag),getElementById:id=>elements.find(node=>node.id===id),querySelectorAll(selector){if(selector==='input[type="file"]')return elements.filter(node=>node.tagName==='INPUT'&&node.type==='file');return elements.filter(node=>selector.split(',').some(part=>node.hasAttribute(part.trim().slice(1,-1))));},addEventListener(type,fn){listeners.set(type,fn);}};
 const saved=new Map([['takodeal_device_id','DEV-SAMPLE-KEPT'],['takodeal_staff_setup_draft_v1','SAMPLE pending setup'],['takodeal_private_phone_identity','SAMPLE old private device'],['firebase:authUser:SAMPLE','SAMPLE retained identity'],['takodeal_attendance_outbox_v1','SAMPLE pending punch']]),before=[...saved];
 const storage={getItem:key=>saved.get(key)??null,setItem(){touches.push('storage.set');throw Error('Saved data must not change');},removeItem(){touches.push('storage.remove');throw Error('Saved data must not change');},clear(){touches.push('storage.clear');throw Error('Saved data must not change');}};
 const nav={onLine:false,serviceWorker:{addEventListener(){},async getRegistration(){touches.push('serviceWorker.getRegistration');throw Error('Offline recovery must not contact the worker');}}};
 const w={localStorage:storage,location:{href:'https://staff.example.invalid/',origin:'https://staff.example.invalid',reload(){touches.push('reload');}},setTimeout(fn,ms){const id=timers.size+1;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),addEventListener(type,fn){windowListeners.set(type,fn);}};
 for(const name of ['auth','db','firebase','indexedDB','caches','fetch'])Object.defineProperty(w,name,{get(){touches.push(name);throw Error('Recovery must not touch '+name);}});
 vm.runInNewContext(source,{window:w,document:d,navigator:nav,Symbol,URL,Promise,Array,Object,Error});
 const action=w.forceUpdateApp;assert.equal(typeof action,'function');assert.equal(action,w[Symbol.for('takodeal.staff.appUpdate')]);assert.equal(installStaffAppUpdate(w,d,nav),action);
 assert.equal(d.getElementById('staffStartupRecovery'),undefined);
 windowListeners.get('error')({target:{tagName:'IMG',src:'https://staff.example.invalid/missing.png'}});assert.equal(d.getElementById('staffStartupRecovery'),undefined,'An unrelated image failure is not a failed app module');
 windowListeners.get('error')({filename:'https://staff.example.invalid/staff-document-model.js'});const banner=d.getElementById('staffStartupRecovery');assert.equal(banner.hidden,false);assert.match(status.textContent,/app files could not open/);
 let prevented=false,stopped=false;listeners.get('click')({target:personal,preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});assert.equal(prevented,true);assert.equal(stopped,true);assert.match(registration.textContent,/app files could not open/);
 assert.equal(await action(),false);assert.match(status.textContent,/Connect to the internet/);assert.equal(w.forceUpdateApp,action);assert.deepEqual([...saved],before);assert.deepEqual(touches,[]);
 const watchdog=[...timers.values()].find(timer=>timer.ms===30000);assert.ok(watchdog);watchdog.fn();assert.equal(banner.hidden,false);assert.match(status.textContent,/could not finish opening/);assert.deepEqual([...saved],before);assert.deepEqual(touches,[]);
});
