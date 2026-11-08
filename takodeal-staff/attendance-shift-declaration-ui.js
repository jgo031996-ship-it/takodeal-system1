import {clockInCoworkers,clockInSwapChoices,makeClockInScheduleDeclaration} from './attendance-shift-declaration.js';
import {renderAttendanceSchedulePreview} from './attendance-schedule-preview.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=value=>new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
export async function chooseClockInSchedule({Swal,document,history,snapshot,profile,staffId,staffName,branch,at,emergencyRelief=null,title='Review your assigned hours',titleText=false,assertCurrent=()=>{}}){
  const input={staffId,staffName,profile,branch,at,snapshot};assertCurrent();
  const reviewed=await Swal.fire({[titleText?'titleText':'title']:title,html:renderAttendanceSchedulePreview(snapshot,{staffName,branch,at,emergencyRelief})+'<p style="font-size:13px;text-align:left">Choose the hours you are working today. An already approved swap appears in your saved assigned hours.</p>',
    input:'radio',inputOptions:{assigned:'My saved assigned hours',swap:'I am swapping with someone · HQ review needed'},inputValue:'assigned',
    inputValidator:value=>!['assigned','swap'].includes(value)?'Choose your saved assigned hours or declare a swap.':undefined,
    showCancelButton:true,confirmButtonText:'Continue Time In',cancelButtonText:'Back to Clock',allowOutsideClick:false,confirmButtonColor:'#16634e',
    didOpen:()=>{const radios=Swal.getPopup?.()?.querySelector('.swal2-radio');if(radios){radios.style.display='grid';radios.style.textAlign='left';radios.style.gap='12px';}}});
  assertCurrent();if(!reviewed.isConfirmed)return {proceed:false,declaration:null};
  if(reviewed.value!=='swap')return {proceed:true,declaration:null};
  const people=clockInCoworkers(history,input),choices=clockInSwapChoices(history,input);
  if(!people.length){await Swal.fire({title:'Coworker list needs HQ confirmation',text:'No active, unambiguous staff accounts were found in the published roster. Ask HQ to update the roster, or return to your saved assigned hours.',icon:'info'});assertCurrent();return {proceed:false,declaration:null};}
  const result=await Swal.fire({title:'Declare an unrequested shift swap',
    html:'<div style="text-align:left;font-size:14px;line-height:1.5"><p>Home-branch staff are listed first. You can choose a coworker from another branch. Each saved shift shows its own branch and work date; your actual attendance stays at <strong>'+escape(branch)+'</strong>.</p>'
      +'<label for="attendanceSwapCoworker">Swapping with</label><select id="attendanceSwapCoworker" style="width:100%;min-height:44px;margin:6px 0 14px"><option value="">Choose a coworker</option>'+people.map(person=>'<option value="'+escape(person.staffId)+'">'+escape(person.name)+' · '+escape(person.homeBranch||'Home branch not recorded')+'</option>').join('')+'</select>'
      +'<label for="attendanceSwapShift">Their saved dated shift</label><select id="attendanceSwapShift" style="width:100%;min-height:44px;margin:6px 0 14px" disabled><option value="">Choose a coworker first</option></select><p id="attendanceSwapAvailability" role="status" style="font-size:12px"></p>'
      +'<label for="attendanceSwapExplanation">Who agreed, and which shift will you cover?</label><textarea id="attendanceSwapExplanation" maxlength="1000" style="width:100%;min-height:88px;margin-top:6px;box-sizing:border-box"></textarea>'
      +'<p style="font-size:12px;color:#7c4a16">This is your declaration for HQ review. It does not approve a swap, change the roster or waive lateness. Any required late explanation and screenshot are still required.</p></div>',
    showCancelButton:true,confirmButtonText:'Declare swap & continue Time In',cancelButtonText:'Back to Clock',allowOutsideClick:false,confirmButtonColor:'#16634e',
    didOpen:()=>{
      const coworker=document.getElementById('attendanceSwapCoworker'),select=document.getElementById('attendanceSwapShift'),notice=document.getElementById('attendanceSwapAvailability');
      coworker.onchange=()=>{
        const available=choices.filter(row=>row.coworkerStaffId===coworker.value);
        select.innerHTML='<option value="">Choose the exact saved shift</option>'+available.map(row=>'<option value="'+escape(row.key)+'">'+escape(row.targetBranch)+' · '+escape(row.targetShiftName)+' · '+escape(when(row.targetStartAt))+' → '+escape(when(row.targetEndAt))+'</option>').join('');
        select.disabled=!available.length;
        notice.textContent=available.length?'Choose the dated shift you intend to cover. It remains a reference for HQ review.':'No saved working shift could be confirmed for this coworker at this time. Ask HQ to confirm the assignment; the app cannot invent their hours.';
      };
    },
    preConfirm:()=>{
      try{
        assertCurrent();const coworker=document.getElementById('attendanceSwapCoworker').value,selection=choices.find(row=>row.key===document.getElementById('attendanceSwapShift').value&&row.coworkerStaffId===coworker);
        if(!selection)throw Error('Choose a coworker and one of their saved dated working shifts.');
        return makeClockInScheduleDeclaration(history,input,selection,document.getElementById('attendanceSwapExplanation').value);
      }catch(error){Swal.showValidationMessage(error.message);return false;}
    }});
  assertCurrent();
  if(result.isConfirmed && (!result.value||result.value.kind!=='unrequested-swap'))throw Error('Complete the coworker and dated shift declaration before continuing Time In.');
  return {proceed:result.isConfirmed===true,declaration:result.isConfirmed?result.value:null};
}
