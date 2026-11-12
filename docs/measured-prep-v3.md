# Measured kitchen production, protocol v3

Base: `cfce3462d095cf2417f75c7bc4a19d6285c0572a` (65 deployable service files).
The implementation adds `prep-measured-model.mjs` and extends only the prep
handler/store, giving 66 deployable service files. Existing v1 and v2 plans,
hashes and saved readers retain their original formats. No other app, route,
authentication, Rules, IAM, package or lock is changed by this backend cohort.

## What is recorded

`qty` is the number of complete recipe batches. Every ingredient debit remains
the saved per-batch recipe quantity multiplied by `qty`. Staff separately enter
the total newly produced usable output in the exact saved base unit, before any
of it has been used. This is a staff weighing attestation, not independent proof
from a scale, and is not a closing balance, leftover count or quantity adjustment.

Both fixed declarations are mandatory before the read-only information request
and each financial request:

```
actualProductionDeclaration: AdditionalUnloggedProduction
measurementDeclaration: MeasuredBeforeAnyUse
```

Expected yield is the saved batch conversion multiplied by `qty`. The entered
actual yield, including zero, is posted exactly once; no quantity is rounded,
clamped, credited or silently reconciled. Recipe ingredients may retain finite
negative balances within the existing v2 bounds. Missing/duplicate sources,
invalid units/conversions, inactive sources and branch ambiguities still hold.

The classified difference is `actual - expected`, except floating point noise
within `max(1, abs(actual), abs(expected)) * Number.EPSILON * 8` is classified as
zero. This affects reason/warning classification only; the entered output is
not changed. A classified difference requires an 8–1000 character reason. An
equal yield permits an empty reason; any nonempty reason must meet the same bound.

## Cashier request and response contract

New operation IDs have the reserved `measured-prep-` prefix, at most 96 characters.
The new protocol is `measured-prep-v3`, response `schemaVersion: 3`. Every Cashier
request uses the existing exact `cashier: {staffId, deviceId, sessionId}` proof.
The server verifies revoked tokens, current approved device/Owner-desktop source,
employee revision, exact SID and active target branch inside each transaction.
It neither creates nor replaces a staff session.

`POST /prep/measured-info` takes exactly the output inventory ID, recipe-batch
quantity, both declarations and Cashier proof. It creates no operation or quote.
Its 12 fields are `schemaVersion`, `protocol`, `branch`, `outputInventoryId`,
`outputName`, `qty`, `purchaseUnit`, `outputUnit`, `expectedOutputQuantity`,
`sourceFingerprint` and both declarations.

The information fingerprint binds configuration: source IDs, branch, names,
units, active/category/conversion fields, recipe revisions and exact ingredient
identities, including unique whitespace-match provenance. It excludes stock
balances and inventory update times, so ordinary sales while entering a weight
do not invalidate unchanged weighing configuration. A financial preview always
reads fresh balances and exact nanosecond revisions.

`POST /prep/measured-preview` takes `operationId`, `outputInventoryId`, `qty`,
`actualOutputQuantity`, `actualOutputUnit`, `sourceFingerprint`, optional
`yieldReason`, both declarations and the Cashier proof. Financial intent hashes
use this canonical sorted-key object:

```
{outputInventoryId, qty, actualProductionDeclaration, measurementDeclaration,
 measurement: {actualOutputQuantity, actualOutputUnit, sourceFingerprint,
               yieldReason: yieldReason || ''}}
```

The preview and every saved/replayed/closed/reversal view explicitly include that
same immutable nested `measurement`, its flat yield fields, `outputWasWritten`,
`expectedFingerprint`, `canCommit`, `warningFingerprint`, `stockWarnings`, and
`requiresWarningAcknowledgement`. Only a fresh valid financial preview has
`canCommit: true`. Source/intent/actor substitutions cannot repin an old quote.

`POST /prep/measured-commit` takes `operationId`, `expectedFingerprint`, both
declarations, Cashier proof, and (if required) exactly
`warningAcknowledgement: {warningFingerprint, acknowledged: true}`. Acknowledgement
is required if any raw balance is negative before/after or yield differs. Its
SHA-256 canonical preimage is:

```
{version:3, kind:'measured-prep-warning-ack', operationId, expectedFingerprint,
 sourceFingerprint, expectedOutputQuantity, actualOutputQuantity, outputUnit,
 yieldDifference, yieldReason, actualProductionDeclaration,
 measurementDeclaration, rows:stockWarnings}
```

The full financial fingerprint also binds the actor, immutable intent, all
current balances/revision tokens, recipe evidence and whitespace provenance.
Commit rederives the plan and compares that exact fingerprint. Stock movement,
operation, logs, raw warning and yield warning are atomic. Same-ID retry returns
the same saved outcome without posting again. Saved acknowledgements, status and
Owner details verify required linked warning records, immutable hashes, actor,
branch/effects and the joint creation timestamp; missing/conflicting audits hold.

## Explicit cancellation and uncertain results

A user who cancels the final preview before commit dispatch may repeat the
original preview body with `closeUnposted: true`. The server closes only the same
actor/intent quote with no saved operation or skipped review. The original view
returns `quoteClosed: true`, `notSaved: true`, `canCommit: false`, original
fingerprint and original measurement. A saved operation wins and returns Saved.
Changing a weight to close another intent is rejected. A closed quote cannot
commit or Skip. A network timeout is not terminal proof: retain the exact local
reference until a typed status/close outcome is confirmed. A new declaration,
weight and operation require a later explicit user action.

Existing `/prep/status`, Owner recovery-close and known-quote seals recognize
only explicit v3 saved kinds while preserving the exact 11-key status DTO.
New-SID status is metadata only and retains the original actor/intent hashes;
it does not authorize adopting an old financial commit. Permanent closure reads
and paired sealed-quote evidence fence all new financial paths.

## Structural Skip without inventing a measurement

When information cannot safely supply a unit/expected yield, a typed 409
`prep/review-required` may include `schemaVersion:3`, protocol, both declarations,
`operationId:null`, `measurement:null` and the server-derived issue fingerprint.
Choosing Skip creates a new measured operation reference and invokes
`/prep/measured-review-skip`, with the existing explicit branch/declaredName/
expectedIssueFingerprint/SkipForNow/note contract and `measurement:null`.
After a financial preview, Skip must carry its exact full measurement instead.
Null measurement is accepted only for this unposted metadata review, never for
a financial quote. The source is rechecked; a repaired source cannot be skipped
under an old warning. Stock remains unposted. The old protected skipped-review
Owner list/detail DTO remains unchanged; there is no automatic approval/repost.

## Zero output and reversal

Zero usable output still consumes the full saved recipe. Its output effect has
delta zero and `outputWasWritten:false`; neither posting nor reversal updates
the output inventory row. A v3-specific zero stock-log observation preserves
the audit without pretending an update timestamp was created. Raw effects and
their logs are posted normally. No second waste deduction is made.

Reversal requires the pristine saved operation, original quantities and units,
and every source revision. Nonzero effects must still have the operation's exact
commit timestamp. The unwritten zero-output row must still have its original
pre-operation revision. Any intervening sale/edit/ABA holds reversal. Exact
reversal restores the original raw balances once and leaves warnings historical.
V1/v2 reversal permissions and fingerprints are unchanged.

## Private Owner warnings

Yield differences create private `prep_yield_warnings/{operationId}`; immutable
review decisions use `prep_yield_warning_reviews/{operationId}`. Both remain
server-only under existing default-deny Rules. No public manager alert is written.
Existing `prep_stock_warnings` supports only its strict v2/v3 source kinds and
retains its existing DTO. Neither inbox permits a stock adjustment, approval,
repost or automatic retry.

Fresh verified Google Owner and canonical active HQ Owner checks, including both
PIN revocation markers, precede private reads. `/prep/yield-warnings` accepts
only `{}` or `{afterOperationId}` and returns `{schemaVersion:1, warnings,
hasMore, nextAfterOperationId}`. It reads 21 by createdAt, returns at most 20,
and uses the exact saved document snapshot as cursor, with no total-backlog claim.

Each summary has exactly 12 fields: `operationId`, `branch`, `outputInventoryId`,
`outputName`, `qty`, `expectedOutputQuantity`, `actualOutputQuantity`,
`outputUnit`, `yieldDifference`, `status`, `stockPosted:true`, `createdAt`.
`/prep/yield-warning-read {operationId}` returns a schema1 wrapper whose warning
adds exactly seven fields: `yieldFingerprint`, `yieldReason`, both declarations,
`reportedBy:{staffId,staffName}`, `reversed`, and
`review:null|{requestId,reason,reviewedAt}`. This gives exactly 19 detail fields.

`/prep/yield-warning-review` requires `operationId`, `expectedYieldFingerprint`,
stable `requestId` and bounded `reason`, and returns that same detail. The private
decision is `ReviewedYieldWarning`. Same exact retry is idempotent; changed
fingerprint is `prep/yield-warning-changed`, a different already-saved decision
is `prep/yield-warning-already-reviewed`. No balance or measurement changes.

## Compatibility and validation

New v3 IDs are rejected by new-server v1/v2 financial routes; no fallback or
pending intent conversion exists. Old live cfce has no measured routes and its
old parsers reject known v3 quote/operation kinds. Client journals must use a
separate nested v3 namespace while preserving the shared foreign-UID pending
work fence. Existing v1/v2 unknown or committed attempts retain original IDs,
protocols, claims and recovery paths. Deployment rollback after v3 data exists
must retain v3 readers; blindly restoring a v1/v2-only server is unsupported.

`measured-prep-inverse.json` pins the two exact old-file extensions and new pure
leaf. The cumulative inverse restores every old v2/recovery/original-PIN/Owner
guard. Ten test-only live-cfce fixture files are exact Git blobs. Focused tests
cover true endpoint response compatibility, zero/reversal, source changes,
warnings, null/full Skip, cancellation, lost ACK and old v1/v2 compatibility.
Actual Admin/race and active-Rules privacy tests run only in hosted CI using
fictional demo projects on loopback. No production quantity writes are tests.
