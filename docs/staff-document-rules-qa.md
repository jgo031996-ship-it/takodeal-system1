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
- `staff_document_config/current`: public GET of exactly `enabled`,
  `policyVersion:2` and the fixed approved `brokerEndpoint`; only verified Owner
  can write. No public list, secret fields or arbitrary upload destination.

HQ authority comes from Owner-protected `hq_email_access/{verifiedEmail}` with
`active:true`, saved `permissions` containing `all` or `branches`, and an exact
allowed branch (or `All`). The existing legacy `isHQUser()` helper is deliberately
unused. Older access records without the protected permissions field are denied.

## Token-free broker and release conditions

The production synthetic test on 2026-10-09 confirmed that an SDK upload creates
a Firebase download token and that its exact anonymous token URL returns the
JPEG even when signed-in Rules protect the object. A check of only a caller's
forged token does not prove that the automatically generated token is private.
The vault was disabled before real employee documents or real bindings were used.

The replacement `staff-document-storage.rules.snippet` denies **all** direct
client operations beneath `staff_private_documents`, including Owner byte reads,
metadata and download-link creation. The legacy fallback excludes that prefix.
Never append a public overlapping allow rule or call a Firebase Storage SDK to
read private bytes. Existing download tokens must be removed separately; a Rules
change alone does not revoke a bearer URL.

Private objects still use
`staff_private_documents/{uid}/{staffId}/{kind}/{uploadId}.jpg`, but a trusted
HTTPS broker verifies current Firebase identity, approved immutable binding or
protected HQ permissions and branch scope. It writes token-free, create-only
GCS objects and returns authenticated JPEG bytes only for the exact committed
current/history metadata. The client preserves atomic Firestore uploads and
reviews. See [the exact runtime, IAM and enablement conditions](private-document-broker.md).

The current local Rules suite passed **34/34** isolated cases on 2026-10-09.
Existing operational and transaction authority is preserved. Local Rules and
fake-server tests do not establish deployed IAM, token-free GCS creation or
real authenticated end-to-end broker behavior; those are prerequisites for
enabling the version-2 configuration. Keep uploads disabled until they pass.

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
paths/MIME/size/metadata, direct private Storage denial even for the Owner,
getDownloadURL denial, old-token capability and cleanup, private lists, disable
behavior, exact broker endpoint configuration, and preceding legacy
transaction/image behavior. Rate checks cover actual atomic
Owner/HQ profile saves, branch and permission denial, immutable private audits,
numeric-string rates, spoofed markers/public histories, initial setup/decreases,
and unrelated preceding profile updates. Structural checks are explicitly
not a Rules interpreter; record actual emulator results separately.

References: [Firebase emulator Rules testing](https://firebase.google.com/docs/rules/unit-tests),
[GCS integration and server authorization](https://firebase.google.com/docs/storage/gcp-integration),
[authenticated HTTP functions](https://firebase.google.com/docs/functions/http-events).
