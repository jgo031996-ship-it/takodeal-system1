import {createCashRemittanceDeviceSession} from './cash-remittance-client.js';
export function createStockAuditDeviceResolver(w,{primaryAuth,signInAnonymously,deviceContext,deviceSession}={}){
 const session=deviceSession||createCashRemittanceDeviceSession(w,{primaryAuth,signInAnonymously,deviceContext});
 return async({action='check',assertCurrent=()=>{}}={})=>{
  const staff=w.sessionUser;const guard=()=>{assertCurrent();if(w.sessionUser!==staff||!staff?.branch||!staff?.staffId)throw Error('Sign in as yourself on the assigned branch tablet.');};guard();
  const result=await session.check(action==='request');guard();
  if(result.status!=='Active')throw Error(result.status==='Pending'?'Tablet approval is pending. Ask the Owner to approve this tablet in Device Fleet. Your counts are kept.':'Request tablet approval, then ask the Owner to approve it. Your counts are kept.');
  const actor=session.capture();actor.assertCurrent();const context=await deviceContext.resolve({assertCurrent:guard});guard();actor.assertCurrent();
  if(context.auth!==session.auth||context.auth.currentUser?.uid!==result.uid||context.auth.currentUser?.isAnonymous!==true)throw Error('The secure tablet changed. Check approval again.');
  const api={...context.deviceApi,get sessionUser(){return w.sessionUser;},assertStockAuditCurrent(){guard();actor.assertCurrent();if(context.auth!==session.auth||context.auth.currentUser?.uid!==result.uid||context.auth.currentUser?.isAnonymous!==true)throw Error('The secure tablet changed. Check approval again.');}};return {api,actorUid:result.uid};
 };
}
