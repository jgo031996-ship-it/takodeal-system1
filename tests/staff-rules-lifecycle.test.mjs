import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import vm from'node:vm';
const policy=readFileSync(new URL('../firestore.policy.rules',import.meta.url),'utf8');
function javascript(name){const at=policy.indexOf('function '+name+'(');assert.ok(at>=0,name);const open=policy.indexOf('{',at);let end=open+1,depth=1;while(depth){if(policy[end]==='{')depth++;if(policy[end]==='}')depth--;end++;}return policy.slice(at,end).replace(/([a-zA-Z]+\.get\('[^']+',''\)|[A-Za-z]+) is string/g,'typeof $1 === "string"').replace(/\.size\(\)/g,'.length').replace(/\.lower\(\)/g,'.toLowerCase()').replace(/!\(([^\n]+?) in (\[[^\]]*\])\)/g,'!$2.includes($1)');}
const context=vm.createContext({});vm.runInContext('Array.prototype.hasAny=function(values){return this.some(value=>values.some(other=>value===other));};'+javascript('companyProfileActive')+'\n'+javascript('companyProfilesActive'),context);
const record=row=>new Proxy(row,{get:(target,key)=>key==='get'?(name,fallback)=>Object.hasOwn(target,name)?target[name]:fallback:target[key]});
const granted=fn=>{try{return fn()===true;}catch{return false;}};
test('combined Clock lifecycle check is exactly the conjunction of both canonical Staff lifecycle predicates',()=>{
 const base={cashierName:'SAMPLE',branch:'SAMPLE Home'},variants=[base];for(const key of ['active','isActive'])for(const value of [false,true,0,'false',null])variants.push({...base,[key]:value});for(const key of ['archived','isArchived','blocked','deleted','isDeleted','revoked','offboarded','resigned','terminated','disabled'])for(const value of [true,false,1,'true',null])variants.push({...base,[key]:value});
 for(const key of ['status','employmentStatus','contractStatus'])for(const value of ['Active','RESIGNED','terminated','inactive','disabled','revoked','archived','blocked','deleted','offboarded','offboard','finished contract','contract ended','end of contract','Ended','Expired','',null,23,{}])variants.push({...base,[key]:value});for(const key of ['cashierName','branch'])for(const value of ['',null,42,[],{},' '])variants.push({...base,[key]:value});for(const pin of ['REVOKED','BLOCKED','blocked','004321',1234,null])variants.push({...base,pin});
 for(let first=0;first<variants.length;first++)for(let second=0;second<variants.length;second++){const a=record(variants[first]),b=record(variants[second]),expected=granted(()=>context.companyProfileActive(a))&&granted(()=>context.companyProfileActive(b));assert.equal(granted(()=>context.companyProfilesActive(a,b)),expected,'variants '+first+' / '+second);}
});

test('business permission dispatch delegates once with exactly the original permission array and branch',()=>{
 const source=javascript('companyBusinessHQ').replace(/root in (\[[^\]]*\])/g,'$1.includes(root)');
 assert.equal((source.match(/companyHQCan\(/g)||[]).length,1);
 const fixture=vm.createContext({calls:[],decision:false});
 vm.runInContext('function companyHQCan(permissions,branch){calls.push({permissions,branch});return decision;}'+source,fixture);
 const expected=root=>['cash_accounts','account_logs','budgets','expenses','payables','foodpanda_payouts','grab_payouts','franchise_ledger','franchise_comms'].includes(root)?['all','accounts','financial-flow','expenses','transfers']
  :['inventory','stock_logs','yield_logs','hq_restocks','dispatch_logs'].includes(root)?['all','inventory','dispatch','low-stock-alerts']
  :['shifts','parked_orders'].includes(root)?['all','history','zreadings','dashboard']
  :root==='equipment_assets'?['all','equipment']:root==='pos_devices'?['all','devices']:root==='branches'?['all','branches']
  :['menu','bom','global_addons'].includes(root)?['all','menu','inventory']:['all','alerts','security-alerts','dashboard'];
 const roots=new Set([...policy.matchAll(/'([^'\r\n]+)'/g)].map(match=>match[1]));roots.add('');roots.add('UNKNOWN');
 for(const root of roots)for(const branch of ['All','SAMPLE Maa',''])for(const decision of [true,false]){
  fixture.calls=[];fixture.decision=decision;assert.equal(fixture.companyBusinessHQ(root,branch),decision);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls)),[{permissions:expected(root),branch}]);
 }
});

test('same-branch HR updates reuse immutable authority while changed branches retain both original checks',()=>{
 const fixture=vm.createContext({enabled:true,allowed:['All'],calls:[]});
 const actual=javascript('companyHRReadPair');assert.equal((actual.match(/\.get\(/g)||[]).length,6);
 const adapted=actual.replace(/(before|after)\.get\('branch',\1\.get\('frozenData',\{\}\)\.get\('branch',''\)\)/g,(_,name)=>"read("+name+",'branch',read(read("+name+",'frozenData',{}),'branch',''))");assert.doesNotMatch(adapted,/\.get\(/);
 vm.runInContext(`function read(map,key,fallback){if(map===null||typeof map!=='object'||Array.isArray(map))throw Error('Invalid Rules map');return Object.hasOwn(map,key)?map[key]:fallback;}
  function companyHRRead(data){const branch=read(data,'branch',read(read(data,'frozenData',{}),'branch',''));calls.push(branch);return enabled&&(allowed.includes('All')||allowed.includes(branch));}
  function original(before,after){return companyHRRead(before)&&companyHRRead(after);}
  ${adapted}
  const records=[{}, {branch:'Maa'}, {branch:'Citygate'}, {branch:''}, {branch:null},
   {frozenData:{branch:'Maa'}},{frozenData:{branch:'Citygate'}},{branch:'Maa',frozenData:{branch:'Citygate'}},
   {branch:'Maa',frozenData:null},{frozenData:42}];
  function invoke(fn,first,second){calls=[];let allowed=false;try{allowed=fn(records[first],records[second])===true;}catch{}return{allowed,calls:calls.length};}`,fixture);
 for(const allowed of [['All'],['Maa'],['Citygate'],[]])for(const enabled of [true,false])for(let before=0;before<10;before++)for(let after=0;after<10;after++){
  fixture.allowed=allowed;fixture.enabled=enabled;const original=fixture.invoke(fixture.original,before,after),actual=fixture.invoke(fixture.companyHRReadPair,before,after);
  assert.equal(actual.allowed,original.allowed,JSON.stringify({allowed,enabled,before,after}));assert.ok(actual.calls<=original.calls);
 }
 fixture.enabled=true;fixture.allowed=['Maa'];assert.equal(fixture.invoke(fixture.companyHRReadPair,1,5).calls,1);assert.equal(fixture.invoke(fixture.companyHRReadPair,1,2).allowed,false);assert.equal(fixture.invoke(fixture.companyHRReadPair,1,2).calls,2);
});
