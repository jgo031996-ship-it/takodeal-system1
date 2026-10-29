import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOnboardingState,onboardingDay,initialContractDates} from '../takodeal-staff/onboarding-model.js';
import {onboardingCardHTML} from '../takodeal-staff/onboarding-ui.js';
const today=new Date('2026-10-29T12:00:00+08:00'),staffId='fictional-established',name='Fictional Established Staff';
const profile={cashierName:name,dateHired:'2025-04-01',contractStatus:'Active',phone:'fictional-phone',address:'fictional-address',emergencyName:'fictional-contact',emergencyNumber:'fictional-number'};
const punch=(date,extra={})=>({id:'fiction-'+date,staffId,staffName:name,type:'TIME IN',timestamp:new Date(date+'T09:00:00+08:00'),...extra});
const build=(change={})=>buildOnboardingState({staffId,profile,attendance:[],attendanceComplete:true,today,...change});
test('established staff keep saved hire-date reminders when ID attendance is empty or temporarily unavailable',()=>{
 for(const complete of [true,false]){const input=structuredClone(profile),before=structuredClone(input),state=build({profile:input,attendanceComplete:complete});
  assert.equal(state.startDate,null);assert.equal(state.firstWorkDate,null);assert.equal(state.reminderStartDate,'2025-04-01');assert.equal(state.reminderStartSource,'Saved hire date');assert.equal(state.establishedStaff,true);assert.equal(state.requirementsDueDate,'2025-04-08');assert.equal(state.probationReviewDate,'2025-10-01');assert.equal(state.needsHRReview,false);assert.ok(state.attendanceEvidenceNotes.length);assert.equal(state.messages.some(row=>row.kind==='welcome'||row.kind==='hr-review'||row.kind==='contract-offer'),false);assert.deepEqual(input,before);
 }
});
test('a later first system punch remains factual evidence but cannot restart an established employee’s reminders',()=>{
 const state=build({attendance:[punch('2026-10-29')]});assert.equal(state.startDate,'2026-10-29');assert.equal(state.firstWorkDate,'2026-10-29');assert.equal(state.reminderStartDate,'2025-04-01');assert.equal(state.requirementsDueDate,'2025-04-08');assert.equal(state.needsHRReview,false);assert.equal(state.messages.some(row=>row.kind==='welcome'),false);assert.equal(state.hireDateDifference,true);
});
test('legacy and renamed attendance remain unconfirmed first-work facts while the saved hire baseline is usable',()=>{
 const rows=[punch('2026-10-29'),punch('2026-10-28',{id:'fiction-previous-name',staffName:'Fictional Previous Name'}),punch('2025-04-01',{id:'fiction-legacy',staffId:undefined})],before=structuredClone(rows),state=build({attendance:rows});
 assert.equal(state.startDate,null);assert.equal(state.firstWorkDate,null);assert.equal(state.reminderStartDate,'2025-04-01');assert.equal(state.needsHRReview,false);assert.match(state.attendanceEvidenceNotes.join(' '),/name-only|previous employee name/);assert.equal(state.messages.some(row=>row.kind==='welcome'),false);assert.deepEqual(rows,before);
 assert.match(state.attendanceEvidenceNotes.join(' '),/Reminders use the saved hire date|reminders use the saved hire date/);assert.doesNotMatch(state.attendanceEvidenceNotes.join(' '),/must confirm|before.*calculated/i);
});
test('Owner-confirmed start wins over both hire date and later system attendance without changing the saved records',()=>{
 const confirmation={version:1,revision:1,date:'2025-03-30',sourceAttendanceId:null,reason:'Fictional Owner reviewed original employment records.',confirmedAt:today,confirmedByUid:'fictional-owner',confirmedBy:'jgo031996@gmail.com',auditId:'fictional-existing-start'},input={...profile,onboardingStartConfirmation:confirmation},before=structuredClone(input),state=build({profile:input,attendance:[punch('2026-10-29')]});
 assert.equal(state.startDate,'2025-03-30');assert.equal(state.reminderStartDate,'2025-03-30');assert.equal(state.reminderStartSource,'HR-confirmed start');assert.equal(state.requirementsDueDate,'2025-04-06');assert.equal(state.needsHRReview,false);assert.deepEqual(input,before);
});
test('work before the saved hire date is a real conflict and keeps its earlier confirmed work evidence',()=>{
 const state=build({profile:{...profile,dateHired:'2026-10-29'},attendance:[punch('2026-10-27')]});assert.equal(state.startDate,'2026-10-27');assert.equal(state.reminderStartDate,'2026-10-27');assert.equal(state.reminderStartSource,'First confirmed Time In');assert.equal(state.needsHRReview,true);assert.match(state.reviewReasons.join(' '),/earlier than the saved hire date/);
});
test('missing dates, invalid boolean hire dates and invalid stored confirmations still need HR review',()=>{
 assert.equal(onboardingDay(false),null);assert.equal(onboardingDay(true),null);assert.equal(onboardingDay([]),null);
 for(const dateHired of [undefined,false,true,'2026-02-30']){const state=build({profile:{...profile,dateHired}});assert.equal(state.reminderStartDate,null);assert.equal(state.needsHRReview,true);if(dateHired!==undefined)assert.match(state.reviewReasons.join(' '),/saved hire date is invalid/);}
 const invalidConfirmation=build({profile:{...profile,onboardingStartConfirmation:{version:1,date:'2025-04-01'}}});assert.equal(invalidConfirmation.startDate,null);assert.equal(invalidConfirmation.reminderStartDate,'2025-04-01');assert.equal(invalidConfirmation.needsHRReview,true);assert.match(invalidConfirmation.reviewReasons.join(' '),/employment-start confirmation/);
});
test('hire-date reminders do not issue contracts or replace saved signed contract terms',()=>{
 const input={...profile,signedContracts:{initial:'April 1, 2025'},contractTerms:{initial:{...initialContractDates('2025-04-01'),signedOn:'April 1, 2025'}}},before=structuredClone(input),state=build({profile:input,attendance:[punch('2026-10-29')]});
 assert.equal(state.contractSigned,true);assert.equal(state.contractEndDate,'2025-10-01');assert.equal(state.offerType,null);assert.equal(state.messages.some(row=>row.kind==='contract-offer'||row.kind==='welcome'),false);assert.deepEqual(input,before);assert.equal(input.contractStatus,'Active');
});
test('Staff card labels the saved hire reminder baseline separately from first Time In evidence',()=>{
 const state=build({attendance:[punch('2026-10-29')]}),rendered=onboardingCardHTML(state);assert.match(rendered,/Reminders based on/);assert.match(rendered,/2025-04-01 · Saved hire date/);assert.match(rendered,/First confirmed Time In/);assert.match(rendered,/2026-10-29/);assert.doesNotMatch(rendered,/Welcome to TAKODEÁL|HR needs to confirm part/);
});
