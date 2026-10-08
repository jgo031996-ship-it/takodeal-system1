# Private Staff document vault verification

The new Firestore collections are independent of legacy operational records. The
Staff PIN, public `cashiers` profile, device name and claimed branch never grant
private document access. An Owner/HQ-All account must approve the anonymous vault
UID and create its immutable employee/branch binding. The normal Staff app uses
its original Firebase instance; the document vault uses a separate named instance.

## Protected authority and schema

- `staff_document_devices/{uid}`: approved immutable `uid`, `staffId`, `branch`;
  an active flag with append-only actor/time audit entries. Owner or protected HQ
  with permission `all` and allowed branch `All` approves/revokes bindings.
- `staff_document_requests/{uid}`: an untrusted pending identity claim. Staff may
  get its own request; only Owner/HQ-All may list and review requests. Approval and
  binding creation are one commit; a request never grants document access itself.
- `staff_private_documents/{staffId}`: protected staff/branch scope for missing
  file reads. Owner/HQ-All writes the scope. Its employee and branch are immutable.
- `staff_private_documents/{staffId}/files/{kind}`: latest pending/approved/rejected
  metadata for `valid_id`, `health_card`, or `clearance` (`NBI`/`POLICE`).
- `versions/{uploadId}`: each upload's metadata and original intent. A review may
  change only its status/review fields together with the latest matching record.
- `reviews/{reviewId}`: immutable scoped audit. Metadata, version and audit must
  change atomically, with matching version, actor, upload, status and timestamps.
- `staff_document_config/current`: public GET of exactly `enabled` and
  `policyVersion:1`; only verified Owner can write. No public list or secret fields.

HQ authority comes from Owner-protected `hq_email_access/{verifiedEmail}` with
`active:true`, saved `permissions` containing `all` or `branches`, and an exact
allowed branch (or `All`). The existing legacy `isHQUser()` helper is deliberately
unused. Older access records without the protected permissions field are denied.

## Storage candidate and release conditions

`staff-document-storage.rules.snippet` is a full **candidate**, not a deployed
policy. The preceding live bucket rule was inspected on 2026-10-07: it
allowed all reads/writes. The candidate preserves that preceding policy outside
`staff_private_documents`, excluding the entire private prefix from that fallback.
Unknown paths and list requests under the private prefix are denied.

Private objects use
`staff_private_documents/{uid}/{staffId}/{kind}/{uploadId}.jpg`.
Only the approved active matching UID can create a new JPEG up to 2 MiB, with
exact bounded employee/group/upload/hash metadata. `resource == null` explicitly
prevents overwrites; no private updates or deletes are allowed. Staff can read
its bound employee's files; verified Owner and protected scoped HQ can read them.
Authorized flows access at most two distinct Firestore documents per Storage
rules evaluation, as required by Firebase.

The Storage emulator filters the reserved `firebaseStorageDownloadTokens` key
out of a caller's custom metadata. Its accepted filtered upload must not be
reported as a rejected request. The authorization test verifies the resulting
exact four custom keys and confirms that the caller's chosen token receives HTTP
403. Arbitrary extra custom keys are rejected. The app never calls
`getDownloadURL`; it reads private bytes through authenticated `getBlob`.

The actual candidate must compile and pass the local authorization suite before
publication. Back up the complete preceding live policy; do not append a private
rule alongside its public wildcard. Enable Storage-to-Firestore rules integration
and verify browser GET CORS for the app origins before enabling uploads.

The published Firestore rule was read again on 2026-10-08 and compared with base
commit `0edca9b4d67b051d4d3c1d3a3bf493b0e5f9bd7d`: it matches after newline
normalization. The new document rules are additive; existing transaction and
operational authority is preserved. The loopback authorization run passed all
31 cases, including six protected rate-audit cases. This does not establish production Storage integration, bucket IAM,
browser CORS or anonymous-auth setup. Keep the vault disabled until those checks
and the Owner-approved policy publication have completed.

On 2026-10-09, the Owner's Firebase console showed the existing Anonymous sign-in
provider as enabled. The complete nine-line published Storage policy was backed
up from the editor; it still grants unrestricted reads and writes. These
read-only observations do not prove the new named client, Storage-to-Firestore
service permissions or browser CORS work in production. Publish the reviewed
Firestore rate-audit policy before deploying the new Owner profile-save code.

For a rollback, disable the document vault configuration and keep the private
Storage prefix protected. Once private files exist, restoring the preceding
public wildcard would expose those files. An application rollback must not
restore that public Storage policy.

## Protected rate-change audit

`staff_rate_changes/{operationId}` is a separate immutable audit. Reads and
creation require a verified Owner or protected active HQ access with a saved
`all`, `payroll` or `feed` permission and matching branch scope. Master Employee
Profile history queries use both employee ID and branch. The audit records the
previous and new daily rate, original branch, actor, timestamp and input hash.
The matching profile update and audit creation must be in the same transaction;
the audit cannot be amended or deleted. Stable operation IDs allow a lost
acknowledgement to be retried without a second increase event.

New profile writes do not store public `rateHistory`. The profile's raise marker
contains only an event ID and version, and rules bind it to an authorized positive
increase audit. An initial rate setup or decrease does not generate congratulations.
Existing numeric-string rates are supported; an unrecognized legacy value is held
for correction instead of inventing a prior rate. These controls do not depend on
the private document vault being enabled or on phone approval.

The current daily rate remains in the preceding legacy profile storage. Its Staff
PIN lock protects the screen, not the legacy database field. This change does not
claim to retrofit the entire preceding public profile or government-ID storage.

Firestore rules cannot prove that a referenced Storage object exists or that its
bytes match a claimed hash. The store therefore verifies actual private bytes,
size and SHA, and HQ approval requires a successful JPEG decoder callback for
that exact file/version/account within five minutes. This UI check is separate
from server authorization. Files and public download URLs must never be copied
into public legacy profile fields or persistent app caches.

## Local tests

Pure state/store/structural checks:

```text
node --test tests/staff-document-model.test.mjs tests/staff-document-store.test.mjs tests/staff-document-rules.test.mjs
```

Real Firebase Rules checks:

```text
node tests/run-staff-document-emulators.mjs
```

The launcher requires isolated tools in `../staff-nextlevel-tools`, including
`runtime.json` pointing to a Java 21 runtime, the verified Firestore/Storage
emulator JARs, and `@firebase/rules-unit-testing` plus `firebase` dependencies.
It writes loopback-only emulator configuration in that tools directory and uses
only `demo-staff-document-vault` at `127.0.0.1:8787` (Firestore) and `:9797`
(Storage). The authorization suite refuses any other endpoints and does not
silently skip missing dependencies. It seeds fake records/bytes only in emulators.

Coverage includes unauthorized/unapproved/revoked/other-employee denial, public
profile spoofing, protected HQ permissions and branch scope, missing-file reads,
device approval/revocation audit, atomic upload/version/review writes, wrong
paths/MIME/size/metadata, byte immutability, private lists, disable behavior, and
preceding legacy transaction/image behavior. Rate checks cover actual atomic
Owner/HQ profile saves, branch and permission denial, immutable private audits,
numeric-string rates, spoofed markers/public histories, initial setup/decreases,
and unrelated preceding profile updates. Structural checks are explicitly
not a Rules interpreter; record actual emulator results separately.

References: [Firebase emulator Rules testing](https://firebase.google.com/docs/rules/unit-tests),
[Storage cross-Firestore rules and the two-document limit](https://firebase.google.com/docs/storage/security/rules-conditions#enhance_with_firestore),
[authenticated browser downloads and CORS](https://firebase.google.com/docs/storage/web/download-files).
