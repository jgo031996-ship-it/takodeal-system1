# Cashier prep review protocol

This backend-only cohort is based on live void server commit `650409386054048399ccda3675a2333fe4188833`. It changes no login, device approval, financial, void, frontend, Firestore, Storage or IAM behavior. Root integrates and publishes only after the hosted gates pass.

## Safe production recording

A verified complete recipe can add its actual positive batch quantity to a negative prepared-output balance. The remaining deficit stays visible. Every raw ingredient must have a finite nonnegative saved balance and sufficient stock. Original IDs, units, ratios, update-time tokens and exact atomic movement/reversal proofs remain mandatory. The output-specific store guard is required to preserve a negative output; raw negative writes remain prohibited.

Recipe lookup first uses the exact saved output name. Only an absent exact recipe may use whitespace normalization (trim and collapse whitespace, preserving case). There must be exactly one normalized saved recipe name and one matching Prepared Batch output in the selected branch. The operation/quote records the original names and `recipeMatch` provenance outside the unchanged plan shape. Candidate census bounds, duplicates, foreign branches, unit issues and changed revisions hold; no recipe is renamed or rewritten.

## Per-item review

Fresh Cashier `POST /prep/preview` semantic failures return HTTP409 `prep/review-required` with `review`:

`{schemaVersion:1,skippable:true,operationId,branch,outputInventoryId,outputName,qty,issue:{code,message,details},issueFingerprint}`.

Authentication, network, database, invalid branch and incomplete bounded-source failures have no skippable review. Clients must never infer Skip permission from human text or an unknown commit result. A malformed existing source cannot borrow the selected tablet branch.

`POST /prep/review-skip` is Cashier-only. Its exact body is:

`{operationId,outputInventoryId,qty,branch,declaredName,expectedIssueFingerprint,skipReason:'SkipForNow',cashier:{staffId,deviceId,sessionId},reason?,note?}`.

The original optional batch reason is unchanged; an optional Owner note is limited to500 characters. The service rechecks the current approved UID, employee/PIN-session revision, device binding/mirror, active branch and source issue inside the transaction. Changed warnings return `prep/review-changed`; fixed issues return `prep/review-not-needed`. Neither outcome posts stock or saves a false review.

Successful Skip atomically closes an existing matching quote and creates private `prep_review_requests/{operationId}`. No public `manager_alerts` write occurs. The quantity, original reason, source diagnostic, reporting employee and optional note stay in the private record. No external messages are sent. No inventory, stock log, prep operation, sale, payment or payroll writes occur.

The terminal result is `{schemaVersion:1,operationId,branch,outputInventoryId,outputName,qty,canCommit:false,notSaved:true,reviewSaved:true,skipped:true,reviewId:operationId,status:'Pending',stockPosted:false,sourceFingerprint,issue}`. `sourceFingerprint` equals the accepted `expectedIssueFingerprint`. Exact same-intent retries return it without another record. A later commit is held as `prep/review-pending`.

If the original operation already prepared stock, Skip instead returns the actual saved result with `saved:true,alreadySaved:true,skipped:false,reviewSaved:false`. A client must count that as prepared, never as an unposted item. Unknown operations retain their original IDs and recovery state.

## Protected Owner inbox

Only the verified Google Owner from the Owner origin, with fresh active canonical HQ Owner authority, can call the following read-only routes. Cashier and Staff cannot list or open another employee's saved review. No new Firestore/Storage grant, IAM permission, index or router prefix is needed.

Only these two new private read routes additionally apply the complete canonical lifecycle flags and both trimmed PIN/securityPin revocation markers before any private read. Ordinary Owner prep and all Cashier route behavior are unchanged by this guard.

`POST /prep/reviews` accepts `{}` or `{afterOperationId}`. The optional cursor must name an existing valid private review; the server uses that exact document snapshot with `createdAt` descending. It reads at most21 and returns up to20; no client timestamp, offset, filter or limit is accepted.

Response: `{schemaVersion:1,reviews:[{operationId,branch,outputInventoryId,outputName,qty,status:'Pending',stockPosted:false,createdAt}],hasMore,nextAfterOperationId}`. The timestamp is a display-only UTC ISO string. `nextAfterOperationId` is the last returned reference only when `hasMore` is true; otherwise null. A first page is never presented as the total backlog.

`POST /prep/review-read` accepts exactly `{operationId}` and returns `{schemaVersion:1,review:{...summary,declaredName,reason,note,issue:{code,message,details},reportedBy:{staffId,staffName},sourceFingerprint}}`. It omits UID, device ID, session ID and source-audit internals. Missing reviews return409 `prep/review-unavailable`; malformed private records return409 `prep/review-incomplete`. These routes do not resolve the issue or change stock. The separate Owner UI must render private details with safe text and keep them out of public feed/storage.

## Verification and limits

The new service tests exercise the actual handler/store/model over an Admin-shaped transactional memory fixture, including private Owner summary/detail projections, cursor pagination and denial cases. Heavy actual Admin and private-rule gates are prepared for the hosted runner; do not start local Java/full suites while the user is using the PC. The existing five Admin tests passed before the pause and are preserved as historical evidence. New gates must pass on the final exact source before publication.

`tests/prep-review-admin.emulator.mjs` uses only fictional `demo-prep-review` data on `127.0.0.1:8874`, refuses other/occupied endpoints, and consumes `TAKODEAL_TEST_TOOLS` (reviewed Java21 runtime.json and emulator1.22.0 jar). The privacy gate uses8873. All new review records remain server-owned; no client grant or approval is added.
