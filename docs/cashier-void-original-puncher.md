# Receipt-specific cashier PIN and legacy receipt compatibility

Base: live `c533ffcb0edc470573c2d35cd27ddf8d3353c182`. Only seven existing cash-remittance runtime files change; the deployable path set stays at 64. Other backend operations, all six clients, Rules, IAM, package manifests and locks are unchanged.

## PIN confirmation without replacing normal sessions

Call the existing `/access/verify-staff-pin` from the canonical Cashier origin with `{pin,staffId,deviceId,app:'cashier',branch,purpose:'receipt-void',scope}`. **Omit `sessionId`.** The scope is SHA256 of UTF-8 canonical JSON (recursive sorted keys, array order retained) of `{operationId,saleId,receiptId,branch,shiftId,reason}`.

The existing six-key response remains `{schemaVersion,staffId,profile,branch,verificationId,expiresAt}`; expiresAt is ISO text. The private proof has purpose `receipt-void`, sessionMode `receipt-only`, sessionId null, and current profile revision. Issuance writes only `staff_pin_verifications`. It never reads/writes/expires a normal or Prep session, directory or PIN context. A registered Owner desktop uses the same freshly verified Google Owner and canonical HQ/physical-registration/target-branch authority as the prior release.

Every void route may carry `pinVerificationId`. `sessionId` in the void envelope is the stable action-local journal nonce, not a global login assertion. The server derives original cashier identity from the pristine saved source and requires the unique **current exact** saved cashierName to map to the PIN-confirmed active staff ID. Current inactive duplicates, known ID/rename conflicts and a profile created after the receipt hold the action. Creation ordering retains nanoseconds. This legacy mapping is operational attribution, not cryptographic historical identity proof; current legacy client-written receipts and PIN visibility have not been migrated by this change.

A new financial preview requires the purpose proof to be fresh within 120 seconds. First use atomically binds the private `cashier_void_pin_claims` record to UID, staff, device, branch, action nonce, operation, source fingerprint, reason and proof. The first manual-unit challenge may create this private binding while returning 409, but writes no receipt/stock/shift/counter/alert. The fixed five-minute binding and quote window permits review after the original proof's two-minute issuance window; it never extends on retry. Current device/Owner and staff source revision are rechecked in every transaction.

New receipt-only quotes/saved operations require their exact action nonce and original or fresh same-operation scoped proof for metadata recovery; they cannot use the old global-SID fallback. Legacy own metadata can still be inspected/cancelled using existing authority or a fresh exact same-operation proof even when the saved receipt names another cashier. Old uncommitted quotes lack the new authorization and cannot commit: cancel the same reference, then start a new receipt review. A saved/paid exact claim may recover without changing original actor, nonce, claim, IDs or payload. No status/cancel path re-voids the source.

## Older missing units

Known malformed/conflicting snapshots and historical name/branch/unit conflicts always hold. Only genuinely absent movement unitSnapshot plus unavailable retained history may use explicit verified-Owner manual review. Generic historical transport failures remain unavailable; they are not human-approval challenges.

The typed 409 `cashier-void/legacy-unit-review-required` includes `unitReview:{schemaVersion:1,fingerprint,sourceFingerprint,rows:[{inventoryId,ingredientName,quantity,unitSnapshot}],disclaimer}`. These are explicitly **current, unconfirmed units**, not original historical evidence. The UI must require each row's acknowledgement and a reason of 8–1000 characters, then repeat the same preview with `ownerUnitReview:{confirmed:true,fingerprint,reason}`. Commit retains its usual expectedFingerprint envelope. The first exact confirmation is immutable; changed reason/hash and changed source/current inventory revision/shift/audit invalidate the review.

The private quote/operation records designate `owner-manual-not-historical`, Owner UID, reason and exact rows/revisions. No manual reason, unit rows or Owner attestation is added to the legacy public manager alert. Quantity remains the original saved movement; no BOM, unit conversion or missing history is guessed.

## Saved options and platform ledger

Bounded empty optional realName/variantName/orderType strings are legitimate. Null, objects, controls, invalid quantity and missing numeric saved unit prices still hold. The raw saved receipt is not rewritten to normalize optional text.

Ordinary unverified, unlinked Grab/Foodpanda receipts may cancel or correct the local ledger. Existing bank/manual/reconciliation/refund/mobile/meal and source/stock safeguards remain. The authenticated view always supplies source.platform Standard/Grab/Foodpanda; legacy saved operations default Standard because prior eligibility prohibited platform sources.

A replacement stays in the saved channel, uses the corresponding canonical payment method, paymentVerified false and an explicitly entered nonempty platformOrderId. Supported order-type aliases are Grab and Foodpanda/Food Panda/Panda (case/outer whitespace normalized only for channel comparison). It may confirm the same real provider order reference; a different provider ID is not invented. Original fields remain on the voided source for audit. This feature performs no external provider cancellation or bank refund. Existing claim/full-payload hash, deterministic replacement IDs and strong ACK rules remain.

## Verification boundaries

Focused local checks use concurrency one. Full normal/SDK, actual Admin and active-policy SDK privacy gates are hosted only to preserve PC responsiveness. Fictional Admin data and loopback emulators perform no production business writes. The exact seven-file inverse restores all live c533 bytes before earlier Owner/prep inverse proofs are applied. No local full suite or Java emulator is run for this change.
