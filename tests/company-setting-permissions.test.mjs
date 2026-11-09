import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const policy=readFileSync(new URL('../firestore.policy.rules',import.meta.url),'utf8');
function declaration(name){
 const start=policy.indexOf('function '+name+'(');assert.ok(start>=0,name);
 const open=policy.indexOf('{',start);let end=open+1,depth=1;
 while(depth){if(policy[end]==='{')depth++;if(policy[end]==='}')depth--;end++;}
 return policy.slice(start,end).replace(/(\w+(?:\.\w+)*) is list/g,'Array.isArray($1)');
}
const list=values=>Object.defineProperty(values,'hasAny',{value:function(other){return this.some(value=>other.includes(value));}});

test('one fresh settings authority read preserves every original permission alternative and exact bridge/branch pairing',()=>{
 const current=declaration('settingHQWrite');assert.equal((current.match(/companyHQAccess\(/g)||[]).length,1);
 const context=vm.createContext({grant:null,owner:false,eligible:true});
 vm.runInContext(`const nativeReplace=String.prototype.replace;
  String.prototype.matches=function(pattern){return new RegExp('^(?:'+pattern+')$').test(this);};
  String.prototype.replace=function(pattern,replacement){return nativeReplace.call(this,new RegExp(pattern,'g'),replacement);};
  Array.prototype.hasAny=function(other){return this.some(value=>other.includes(value));};
  function isOwner(){return owner;}function isSignedIn(){return eligible;}
  function reqProvider(){return 'google.com';}function reqVerified(){return true;}
  function companyHQAccess(){return grant;}
  ${declaration('companyHQCan')}
  ${declaration('companyHQGrantCan')}
  ${current}
  function originalSettingHQWrite(id){
   return isOwner() || companyHQCan(['all','posconfig'],'All')
    || id.matches('^(global_schedule|schedule_.+)$') && companyHQCan(['all','schedule'],'All')
    || id.matches('^recipe_.+') && companyHQCan(['all','inventory','menu'],'All')
    || id == 'global_delivery_schedule' && companyHQCan(['all','dispatch'],'All')
    || id.matches('^sop_.+') && companyHQCan(['all','sop'],id.replace('^sop_',''));
  }`,context);
 const names=['other','global_schedule','schedule_Maa','recipe_1','global_delivery_schedule','sop_Maa','sop_Citygate','sop_','schedule_','recipe_'];
 const keys=['all','posconfig','schedule','inventory','menu','dispatch','sop','irrelevant'];
 const permissions=[[],...keys.map(key=>[key]),...keys.flatMap((key,index)=>keys.slice(index+1).map(other=>[key,other])),keys].map(list);
 const branches=[[],['All'],['Maa'],['Citygate'],['Maa','Citygate']].map(list);
 const grants=permissions.flatMap(permissions=>branches.map(allowedBranches=>({active:true,permissions,allowedBranches,bridgeRequired:false,bridgePermissions:list([]),bridgeBranches:list([])})));
 let comparisons=0;
 for(const primary of grants)for(const bridge of grants){
  context.grant={...primary,bridgeRequired:true,bridgePermissions:bridge.permissions,bridgeBranches:bridge.allowedBranches};
  for(const id of names){assert.equal(context.settingHQWrite(id),context.originalSettingHQWrite(id),id+' '+JSON.stringify(context.grant));comparisons++;}
 }
 for(const grant of grants)for(const active of [true,false])for(const owner of [true,false])for(const eligible of [true,false]){
  context.grant={...grant,active};context.owner=owner;context.eligible=eligible;
  for(const id of names){assert.equal(context.settingHQWrite(id),context.originalSettingHQWrite(id));comparisons++;}
 }
 assert.equal(comparisons,376200);
});
