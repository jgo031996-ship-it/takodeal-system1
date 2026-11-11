# Additional unlogged actual production: prep v2

Base `df5bd24cbfaa0176d6b950f9009df11e8ad471ce`. This is production recording, not a stock quantity adjustment or a way to approve old skipped records. Four existing prep modules are extended and one pure validation leaf is added; the cash function source closure is 65 files. Other financial operations, six application trees, Rules, IAM, runtime/dependency configuration and router are unchanged in this backend cohort.

## Cashier protocol

Only an existing approved Cashier action with fresh token, current employee/PIN session, device/binding or verified Owner desktop authority and exact working branch can use these routes. Existing normal/Prep sessions are neither replaced nor cleaned up.

All new references start `actual-prep-` and use an immutable v2 journal namespace under the existing UID prefix. V1 unknown/pending references must be recovered in their original protocol. No timeout, wrong proof, missing recipe or old-server response permits a new-ID or v1 fallback.

- `/prep/actual-preview`: `{operationId,outputInventoryId,qty,actualProductionDeclaration:'AdditionalUnloggedProduction',reason?,cashier}`.
- `/prep/actual-commit`: `{operationId,expectedFingerprint,actualProductionDeclaration:'AdditionalUnloggedProduction',warningAcknowledgement?:{warningFingerprint,acknowledged:true},cashier}`.
- `/prep/actual-review-skip`: existing SkipForNow body plus the fixed declaration. Typed semantic issue proof and saved response are schema 2 / `protocol:'actual-prep-v2'`; the immutable private skipped row is `actual-prep-review`, version 2, `stockPosted:false`.

The fixed declaration means the employee asserts this is **additional actual production not already logged/counted**. It must not be used to re-enter a batch already included in stock. The server calculates the exact saved recipe, units, source IDs/revisions, output conversion and positive ingredient consumption. It never guesses a recipe or resets/credits raw stock. Raw and output balances remain finite within ±1e12. An ingredient may become or remain negative solely by subtracting the real recipe usage. Missing/inactive/duplicate/unit/recipe/conversion, invalid quantity and stale-source protections remain.

Preview includes the ordinary plan view plus schemaVersion 2, protocol, declaration, expectedFingerprint, warningFingerprint, stockWarnings and requiresWarningAcknowledgement. Each affected raw row is exactly `{inventoryId,itemName,unit,beforeStock,delta,afterStock}`, where delta is negative and either recorded before/after is negative. Commit requires explicit acknowledgement of the exact operation/actor/source-bound warning fingerprint when rows are present; without rows acknowledgement is absent. Quote expiry and all source checks still apply. A changed source closes a repeated preview under its **original** fingerprint with `quoteClosed:true`, `notSaved:true`; it never silently repins the reference.

The stock updates, linked logs, immutable `actual-prep` version-2 operation and private `prep_stock_warnings` document are committed in one transaction. Saved response/retry includes its immutable expectedFingerprint and `canCommit:false`. Exact same-op retry cannot post twice. Saved status, AlreadySaved response and Owner warning reads verify the linked warning against operation ID, original actor, branch, movements, fingerprints and the joint commit timestamp. Missing/conflicting evidence holds instead of falsely acknowledging.

## Historical compatibility and recovery

V1 planner output, quote/op hashes, ordinary strict raw guards and reversal behavior remain compatible. Dedicated v2 store methods do not broaden generic version-1 creation or negative ingredient updates. V1 financial routes reject new operation prefixes; actual routes reject legacy IDs. Exact old df5 fixtures show unknown actual routes are refused (Cashier origin 403, Owner origin 404) and old parsers reject known v2 kinds before stock writes. There is no automatic fallback.

The existing exact eleven-key status DTO remains unchanged. V2 intentHash includes the declaration; actorFingerprint still includes the original UID/staff/device/SID. A fresh SID for the same actor can read metadata only. Permanent Owner closure fences actual preview/commit/skip too. A known v2 quote is sealed while preserving its original kind/plan/intent in private closure evidence; old parsers reject the sealed kind. A skipped actual source issue is a private **unposted** report, never an implicit production approval.

V2 reversal uses the original immutable v2 movement snapshot and current exact quantities, units and nanosecond commit revisions. It can restore an original still-negative raw balance; it cannot guess from the current recipe or reverse after intervening activity/ABA. V1 signed-ingredient rejection remains unchanged. Reversal and warning review preserve the historical warning record.

After v2 data exists, do not blindly roll the backend back to a v1-only reader. Retain v2 status/warning/closure/reversal interpretation even if new v2 posting is disabled. Older clients hold the reserved journals rather than consuming them as old stock operations.

## Private Owner warning inbox

Verified Google Owner plus fresh canonical HQ lifecycle and both PIN revocation markers is required before every private read/review. There are no public manager-alert writes.

- `/prep/stock-warnings` accepts `{}` or `{afterOperationId}`. It returns `{schemaVersion:1,warnings,hasMore,nextAfterOperationId}` using one createdAt ordering and an exact saved document cursor, 20 rows plus one lookahead. All Pending/Reviewed records remain pageable; the first page is not the total backlog.
- Summary has exactly nine keys: operationId, branch, outputInventoryId, outputName, qty, status, stockPosted:true, createdAt, warningCount.
- `/prep/stock-warning-read {operationId}` returns `{schemaVersion:1,warning:{...summary,warningFingerprint,rows,reportedBy:{staffId,staffName},reversed,review}}`. Review is null or `{requestId,reason,reviewedAt}`. Balances are historical at posting, not current inventory.
- `/prep/stock-warning-review {operationId,expectedWarningFingerprint,requestId,reason}` returns the same detail DTO. It creates only a private immutable `ReviewedPostedWarning` decision in `prep_stock_warning_reviews`. It never adjusts/reposts/approves stock. Same exact request/reason retries; conflicting saved decisions return `prep/warning-already-reviewed`, and an incorrect digest returns `prep/warning-changed`.

Both new tables remain server-only under existing default-deny Rules. No new financial authorization, device approval, raw roster privacy cut, physical quantity repair or external refund is claimed.

## Verification

Local lightweight gates cover 27 actual-prep tests, 44 prior prep/recovery service tests, 27 prior model/Owner service tests and exact source inverses/old df5 fixture hashes. Full normal/locked-SDK checks and Java tests run hosted only. Prepared `tests/actual-prep-admin.emulator.mjs` has 20 real Admin cases on port 8884; `tests/actual-prep-private-rules.emulator.mjs` has two server-only table cases on port 8885, using the existing TAKODEAL_TEST_TOOLS / PREP_RULES_FILE pattern. No local Java, SDK install or live business writes were used.
