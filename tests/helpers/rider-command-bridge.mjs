import*as core from'../../functions/cash-remittance-review/rider-command-model.mjs';
// Existing optimistic UI fixtures exercise the unchanged business transaction
// model locally. Separate transport and real Admin suites cover broker authority.
const actions={availability:core.setRiderAvailabilityAtomic,location:core.setRiderLocationAtomic,claim:core.claimDeliveryAtomic,'accept-ping':core.acceptPingAtomic,pickup:core.pickupDeliveryAtomic,complete:core.completeDeliveryAtomic,decline:core.rejectPingAtomic,'topup-request':core.requestRiderTopUpAtomic,'review-status':core.reviewRiderStatusAtomic,'review-topup':core.reviewRiderTopUpAtomic};
export function riderCommandBridge(api){return{reserve:(_action,input)=>input.operationId,recover:async()=>null,execute:(action,input)=>actions[action]({...api,now:Date.now},input)};}
