const bases=['Legal authority permitting this deduction','Court / authorized agency order'];
export const DEDUCTION_AUTHORITY_SOURCES=Object.freeze([
 {title:'Labor Code and deduction conditions · Supreme Court',url:'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/56812'},
 {title:'Implementing Rules · Book III, Rule VIII, Section 14',url:'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/85819'}
]);
const clean=(value,limit=160)=>String(value??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,limit);
export function deductionAuthorityDraft(basis,{amount,label}={}){
 if(!bases.includes(basis))return '';
 const value=Number(amount),money=Number.isFinite(value)&&value>0?'₱'+value.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}):'the proposed amount';
 const subject=clean(label)||'the incident under review';
 if(basis===bases[0])return 'Proposed review of '+money+' for '+subject+'. Philippine Labor Code Article 113(c) requires applicable legal or regulatory authority for a wage deduction. For loss or damage governed by Book III, Rule VIII, Section 14, the employer must establish that the rule applies, clearly establish responsibility, allow a reasonable explanation, limit the amount to a fair actual loss, and observe the 20% weekly wage limit. Specific authority and why it applies: [Complete the applicable provision and facts]. The staff member may dispute the facts or request a correction. This draft alone authorizes no deduction.';
 return 'Proposed review of '+money+' for '+subject+'. Only the deduction and amount permitted by a valid, applicable court or authorized agency order may be recorded. Order reference, issuing court or agency, date, and why it applies: [Complete the order reference and applicability]. The staff member may request a copy, dispute the facts, or ask for a correction. This draft does not establish that an order exists and alone authorizes no deduction.';
}
export function assertCompletedDeductionAuthority(value){
 const text=String(value??'').trim();
 if(/\[Complete (?:the applicable provision and facts|the order reference and applicability)\]/i.test(text))throw Error('Complete the specific legal provision or order reference and why it applies before reviewing approval.');
 return text;
}
// Keep an Owner's edits. A changed selection replaces only an untouched draft.
export function installDeductionAuthorityDraft(select,textarea,{context=()=>({}),button,onDraft=()=>{}}={}){
 if(!select||!textarea)return null;let previous='',generated=false;
 const apply=force=>{const draft=deductionAuthorityDraft(select.value,context());if(!draft)return false;if(!force&&String(textarea.value||'').trim()&&textarea.value!==previous)return false;textarea.value=draft;previous=draft;generated=true;onDraft(draft);return true;};
 select.addEventListener('change',()=>apply(false));if(button)button.addEventListener('click',()=>{if(!String(textarea.value||'').trim()||textarea.value===previous)apply(true);else onDraft(null);});
 return {apply:()=>apply(false),wasGenerated:()=>generated};
}
