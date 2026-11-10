# Guarded Cashier void service

This additive backend is based on `59281163035148857338546185224579a7e46f63`. The existing HTTP wrapper routes only `/cashier-void/` to `createCashierVoidHandler({verifyToken, store:createCashierVoidStore(db,{serverTimestamp})})`. The wrapper must pass the original bearer, exact Origin, JSON body/raw byte size, method/query, preflight fields, and the trusted socket peer as `trustedIP`. `verifyToken` is always called with revocation checking enabled.

## Authority and supported receipts

Each action requires the exact anonymous approved POS UID, device, operational branch, active legacy mirror, current staff login session nonce/expiry, and active staff source update-time revision. They are re-read inside the same Admin transaction as any effect. The initial void requires the original current open shift.

Eligible receipts are completed ordinary POS v2 sales with an unchanged source and exact five-field permanent commit marker. The source create/update times and marker create/update times must all match exactly. `serverTimestamp` is REQUEST_TIME with millisecond precision, rather than the exact commit timestamp: it must be valid, at or before the joint commit and within the bounded request-processing window. Historical unit reads use the exact source **createTime**, without rounding.

The service holds edited, reconciled, manually verified, verified noncash, refund, meal, staff-purchase, platform, mobile/delivery, prepared-food, ambiguous, and stock-review records for the Owner's existing linked process. Cash receipts legitimately have `paymentVerified:true`. Ordinary percentage/fixed discounts can be voided; replacement discounts are reviewed again by the normal checkout.

Applied reversals use only captured inventory IDs and quantities. New receipts carry `unitSnapshot:{schemaVersion:1,baseUom:string|null,uom:string|null}` captured from stock and checked by the new client engine at commit. Both raw aliases are preserved; at least one must be nonblank, and two nonblank aliases must agree after trim/lowercase. Current units must still match that identity. Later ordinary sales/counts therefore do not by themselves prevent a reversal.

For old receipts without unit snapshots, the server may read the exact original inventory versions within the ordinary one-hour retention window using an Admin read-only transaction with exact `readTime`. Both historical readTime and inventory updateTime must match the original commit. The resulting minimal unit proof is stored in the private quote. Unavailable/older/mismatched evidence holds for Owner review. PITR is never enabled or changed. An active physical count holds an applied reversal; a deferred deduction can be cancelled without adding stock.

The existing ordinary sale creation boundary remains a legacy client-created source. Joint metadata detects later source edits, and historical data proves original units; this feature does not claim cryptographic or server-derived proof of the original pricing/deductions or full database security.

## Wire protocol

Every request has exact common fields:

`operationId,deviceId,staffId,sessionId,branch,shiftId,saleId,receiptId,reason`.

`reason` is exactly `OrderCancelled` or `WrongPunched`. Operation IDs are stable 8–96-character alphanumeric/underscore/hyphen references. The body limit is 8 KiB, except replacement claims (140 KiB envelope / 128 KiB canonical payload). No query parameters are accepted. Only the canonical Cashier origin is allowed.

| POST path | Additional fields | Result |
| --- | --- | --- |
| `/cashier-void/preview` | none | Five-minute frozen quote; never extends the same quote's expiry. |
| `/cashier-void/commit` | `expectedFingerprint` | Atomic stock/statistic reversal, shift revision, audit, source claim and terminal own outcome. |
| `/cashier-void/status` | none | Own saved/cancelled/preview/unknown result; replacement is independently checked. |
| `/cashier-void/cancel` | none | Permanent cancellation tombstone; cannot undo a committed void. |
| `/cashier-void/replacement-claim` | `expectedFingerprint,phase,restoreAttemptId,claimToken` | Draft claim, abandonment, or checkout claim described below. |

All successful envelopes contain exactly `schemaVersion,operationId,sourceSaleId,sourceReceiptId,branch,shiftId,reason,state,sourceFingerprint,expectedFingerprint,expiresAt,source,effects,replacement`. Source and fingerprint values may be null for an unknown/cancelled reference. Private namespaces are `cashier_void_quotes`, `cashier_void_operations`, and `cashier_void_sources`; the active Rules deny all direct client CRUD/list on these namespaces, including the Owner.

The source transaction remains present, its original permanent commit marker remains present, and payment/refund/reconciliation fields are preserved. Stats and stock reverse once. A boolean legacy `already voided` response is never used to authorize a correction draft. Lost replies recover the same operation; another operation cannot claim the same original source.

## Wrong Punched replacement

The server reserves one deterministic new sale ID/receipt ID per original source. The frozen editable cart contains only explicit saved item prices/options/quantities; no customer/payment verification, meal authority, recipe, original sale ID or stock snapshot is restored as payment authority.

`phase:'draft'` permanently claims a single `restoreAttemptId` before cart restoration. Reload can resume that same draft; another tab cannot obtain a second owner. `phase:'abandon'` is allowed only while no checkout claim or receipt/marker exists. An existing draft requires its exact owner. If no draft exists, the operation owner can explicitly abandon the unclaimed reservation, including after shift closure; that attempt ID becomes the terminal abandonment reference. Abandonment and first draft acquisition serialize in the private transaction. This leaves the original void intact and permanently marks the replacement abandoned. A claimed/possibly queued checkout cannot be discarded this way.

`phase:'checkout'` also requires `checkoutAttemptId,payload`. The client first runs normal pricing/recipe preparation, durably journals the exact prepared payload/attempt, claims it, then enqueues that exact payload in the correction-only outbox. One full payload hash is frozen privately. Another attempt or any different payload is held. The hash is SHA-256 of UTF-8 JSON with recursively sorted object keys and preserved array order; only finite plain JSON data is accepted.

Public payload `voidCorrection` has exactly seven fields: `schemaVersion,operationId,sourceSaleId,sourceReceiptId,sourceFingerprint,checkoutAttemptId,claimTokenHash`. `claimTokenHash` is SHA-256 of the raw random claim token. The raw token stays in private RPC/journal data and never enters the public receipt or manager audit.

Status verifies the claimed receipt's complete immutable checkout projection and permanent marker. It re-derives only the new engine's exact allowed unit-review subset/issues mapping, so a paid receipt with held unit deductions can be acknowledged truthfully. The old weak marker alone cannot authorize correction ACK. The dedicated client correction outbox prevents an older ordinary v2 worker from consuming this protocol. A source void is not evidence that a replacement checkout was paid.

## Operational limits

This action fails closed with Owner/tablet setup guidance on devices that lack protected approval; it never approves or binds a device. Existing entry, ordinary sales and saved queues remain in their existing paths. The feature records a void and stock correction, not a refund transfer. After a checkout claim, uncertain payment/queue outcomes retain the exact reserved IDs for retry or Owner review. There is no automatic new-ID fallback, credential migration, financial permission grant, or database/IAM configuration change.
