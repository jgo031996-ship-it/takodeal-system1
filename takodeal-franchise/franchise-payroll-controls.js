// Cutoff selection only. Loading a cutoff never records a payroll payment.
const dayPattern=/^\d{4}-\d{2}-\d{2}$/;
const validDay=day=>typeof day==='string'&&dayPattern.test(day)&&Number.isFinite(Date.parse(day+'T12:00:00Z'))&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;
const defaultToday=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const copy=range=>({start:range.start,end:range.end});
let instance=0;

export function validatePayrollCutoff(value){
 if(!value||!validDay(value.start)||!validDay(value.end)||value.start>value.end)throw Error('Choose a valid cutoff start and end date. The end must be on or after the start.');
 if(Date.parse(value.end)-Date.parse(value.start)>366*86400000)throw Error('Choose a payroll cutoff of one year or less.');
 return copy(value);
}
export function halfMonthPayrollCutoff(month,half){
 if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month)||!validDay(month+'-01')||!['first','second'].includes(half))throw Error('Choose a valid cutoff month.');
 const first=new Date(month+'-01T12:00:00Z'),next=new Date(first);next.setUTCMonth(next.getUTCMonth()+1);next.setUTCDate(0);
 return {start:month+(half==='first'?'-01':'-16'),end:half==='first'?month+'-15':next.toISOString().slice(0,10)};
}
export function currentPayrollCutoff(day=defaultToday()){
 if(!validDay(day))throw Error('Choose a valid Philippine calendar date.');
 return halfMonthPayrollCutoff(day.slice(0,7),Number(day.slice(-2))<=15?'first':'second');
}
export function payrollCutoffQueryRange(value){
 const {start,end}=validatePayrollCutoff(value);
 // The payslip model starts at PH midnight and retains the next day's 18:00
 // boundary for an overnight shift that started on the final cutoff date.
 return {startDate:new Date(start+'T00:00:00+08:00'),endDate:new Date(Date.parse(end+'T16:00:00Z')+18*3600000)};
}

export function installFranchisePayrollControls({root,document:d=globalThis.document,branch=()=>'',today=defaultToday,onApply=()=>{},onError=()=>{},initialRange}={}){
 if(!root||!d?.createElement)throw Error('A payroll cutoff container is required.');
 let applied=initialRange?validatePayrollCutoff(initialRange):currentPayrollCutoff(today()),loading=false,destroyed=false,generation=0,renderedBranch=String(branch()||'');
 const prefix='franchisePayrollCutoff'+(++instance),listeners=[];
 const el=(tag,cls,text)=>{const node=d.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
 const panel=el('section','payroll-cutoff');panel.setAttribute('aria-label','Payroll cutoff');
 const heading=el('div','payroll-cutoff-heading'),copyBlock=el('div');copyBlock.append(el('h3','','Choose a payroll cutoff'),el('p','','Choose dates, load payroll, then generate a payslip for a staff member.'));heading.append(copyBlock);
 const summary=el('p','payroll-cutoff-applied');summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');
 const form=el('form','payroll-cutoff-form');form.noValidate=true;
 const label=(text,node)=>{const item=el('label','',text);item.htmlFor=node.id;item.append(node);return item;};
 const month=el('input');month.type='month';month.id=prefix+'Month';month.setAttribute('data-payroll-month','');
 const from=el('input');from.type='date';from.id=prefix+'Start';from.required=true;from.setAttribute('data-payroll-start','');
 const to=el('input');to.type='date';to.id=prefix+'End';to.required=true;to.setAttribute('data-payroll-end','');
 const presets=el('div','payroll-cutoff-presets');presets.setAttribute('role','group');presets.setAttribute('aria-label','Standard payroll cutoffs');
 const first=el('button','secondary-button','1st–15th'),second=el('button','secondary-button','16th–month end');
 first.type=second.type='button';first.setAttribute('data-payroll-half','first');second.setAttribute('data-payroll-half','second');presets.append(first,second);
 const standard=el('div','payroll-cutoff-standard');standard.append(label('Cutoff month',month),presets);
 const custom=el('div','payroll-cutoff-custom');custom.append(label('Cutoff start',from),label('Cutoff end',to));
 const applyButton=el('button','primary-button','Load payroll');applyButton.type='submit';applyButton.setAttribute('data-payroll-apply','');custom.append(applyButton);
 const validation=el('p','payroll-cutoff-error');validation.id=prefix+'Error';validation.hidden=true;validation.setAttribute('role','alert');
 for(const input of [month,from,to])input.setAttribute('aria-describedby',validation.id);
 const hint=el('p','payroll-cutoff-hint','');hint.setAttribute('aria-live','polite');
 form.append(standard,custom,validation,hint);panel.append(heading,summary,form);root.append(panel);
 function assertActive(){if(destroyed)throw Error('The payroll cutoff controls are closed.');}
 function clearError(){validation.textContent='';validation.hidden=true;for(const input of [month,from,to])input.removeAttribute('aria-invalid');}
 function displayError(error,{report=false}={}){
  validation.textContent=error?.message||'The payroll cutoff could not load. Try again.';validation.hidden=false;
  if(report)onError(error);
 }
 function draw(){
  summary.textContent=String(branch()||'Selected branch')+' · Selected cutoff: '+applied.start+' to '+applied.end+' (PH)';
  const dirty=from.value!==applied.start||to.value!==applied.end;
  hint.textContent=loading?'Loading this cutoff…':dirty?'Dates changed. Choose Load payroll to show payslips for these dates.':'Use Generate payslip beside a staff member below. Paid records show View paid payslip.';
  for(const [button,half]of [[first,'first'],[second,'second']]){
   let selected=false;try{const expected=halfMonthPayrollCutoff(month.value,half);selected=expected.start===from.value&&expected.end===to.value;}catch{}
   button.setAttribute('aria-pressed',String(selected));
  }
  for(const input of [month,from,to,first,second,applyButton])input.disabled=loading;
  applyButton.textContent=loading?'Loading payroll…':'Load payroll';panel.setAttribute('aria-busy',String(loading));
 }
 function setDraft(value){from.value=value.start;to.value=value.end;month.value=value.start.slice(0,7);clearError();draw();}
 function chooseHalf(half){
  assertActive();if(loading)return;
  try{setDraft(halfMonthPayrollCutoff(month.value,half));}catch(error){month.setAttribute('aria-invalid','true');displayError(error);}
 }
 async function apply(){
  assertActive();if(loading)return false;
  let next;
  try{halfMonthPayrollCutoff(month.value,'first');}catch(error){month.setAttribute('aria-invalid','true');displayError(error);return false;}
  try{next=validatePayrollCutoff({start:from.value,end:to.value});}catch(error){from.setAttribute('aria-invalid','true');to.setAttribute('aria-invalid','true');displayError(error);return false;}
  clearError();applied=next;const token=++generation;loading=true;draw();
  try{await onApply(copy(applied));return true;}
  catch(error){if(!destroyed&&token===generation)displayError(error,{report:true});return false;}
  finally{if(!destroyed&&token===generation){loading=false;draw();}}
 }
 listen(first,'click',()=>chooseHalf('first'));listen(second,'click',()=>chooseHalf('second'));
 listen(form,'submit',event=>{event.preventDefault();void apply();});
 for(const input of [from,to])listen(input,'input',()=>{if(loading)return;clearError();draw();});
 listen(month,'change',()=>{
  if(loading)return;
  try{const half=Number(from.value.slice(-2))<=15?'first':'second';setDraft(halfMonthPayrollCutoff(month.value,half));}catch(error){month.setAttribute('aria-invalid','true');displayError(error);}
 });
 setDraft(applied);
 return {
  element:panel,
  getRange(){assertActive();return copy(applied);},
  getDraftRange(){assertActive();return {start:from.value,end:to.value};},
  queryRange(){assertActive();return payrollCutoffQueryRange(applied);},
  apply,
  sync({newLoad=false}={}){assertActive();const nextBranch=String(branch()||'');if(newLoad||nextBranch!==renderedBranch){generation++;renderedBranch=nextBranch;loading=false;}draw();},
  setLoading(value){assertActive();loading=Boolean(value);draw();},
  reset(day=today()){assertActive();const next=currentPayrollCutoff(day);generation++;renderedBranch=String(branch()||'');applied=next;loading=false;setDraft(next);},
  destroy(){if(destroyed)return;destroyed=true;generation++;for(const remove of listeners)remove();panel.remove();}
 };
}
