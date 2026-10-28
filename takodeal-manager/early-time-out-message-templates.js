export const EARLY_TIME_OUT_MESSAGE_TEMPLATES = Object.freeze([
    Object.freeze({id:'schedule-corrected',label:'Schedule corrected',text:'We reviewed the reported schedule issue and confirmed the assigned shift shown above. Please follow these verified hours. Your original attendance punches remain on record.'}),
    Object.freeze({id:'emergency-cover',label:'Emergency cover or shift swap',text:'We reviewed the emergency cover or shift swap with the branch and confirmed the assigned hours shown above. Please follow the verified schedule and complete the usual handover.'}),
    Object.freeze({id:'finish-passed',label:'Scheduled finish has passed',text:'We reviewed your recorded shift. The verified scheduled finish has already passed, so early time-out approval is not required. This review does not record a Time Out or change your worked hours.'}),
    Object.freeze({id:'decline',label:'Decline this request',text:'We reviewed this request and cannot approve it with the information currently on file. Please contact your branch lead or submit the correct details for another review.'})
]);

// Templates supply editable wording only. They never select times or decisions.
export function earlyTimeOutMessageTemplate(id) {
    return EARLY_TIME_OUT_MESSAGE_TEMPLATES.find(template=>template.id===id)?.text || '';
}
