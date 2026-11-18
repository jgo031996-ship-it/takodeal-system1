import {profileError} from './staff-private-profile-model.mjs';
export const nameFields=['cashierName','fullName','name','scheduleNickname','scheduleName','nickname'];
export const normalizeName=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
export const employeeNames=row=>[...new Set([...nameFields.map(key=>row?.[key]),...(Array.isArray(row?.scheduleAliases)?row.scheduleAliases:[])].filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))];
export function identityPatch(source,patch,others=[]){
 if(!Object.hasOwn(patch,'cashierName')&&!Object.hasOwn(patch,'scheduleNickname'))return patch;
 const full=patch.cashierName??source.cashierName,nick=patch.scheduleNickname??source.scheduleNickname??'';
 if(typeof full!=='string'||full.trim().length<2||full.length>160||typeof nick!=='string'||nick.length>80)throw profileError(400,'name','Enter your full name and a nickname of up to 80 characters.');
 const aliases=employeeNames(source),names=[full,nick].filter(Boolean),keys=new Set(names.map(normalizeName));
 if(others.some(row=>employeeNames(row).some(value=>keys.has(normalizeName(value)))))throw profileError(409,'name','This name or nickname already belongs to another employee. Use a distinct full name or nickname.');
 const history=[...new Set([...aliases,...names])];if(history.length>100)throw profileError(409,'name','Your name history needs to be consolidated before another change.');
 return{...patch,cashierName:full,name:full,fullName:full,scheduleNickname:nick,scheduleName:nick,nickname:nick,scheduleAliases:history};
}
