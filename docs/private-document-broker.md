# Private document broker: reviewed design and deployment conditions

The current production vault remains disabled. The old Firebase download-token probe returned the synthetic JPEG to an anonymous token request, so that client-Storage path must not handle real employee documents. This replacement transfers bytes through one authenticated server and returns no reusable download URL or token.

## Fixed service and protocol

- Project: `takodeal-pos`; bucket: `takodeal-pos.firebasestorage.app`.
- Proposed function: `staffDocumentBroker`, region `asia-southeast1`, exact base `https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker`.
- Exact browser origins: `https://takodeal-staff.vercel.app` and `https://takodeal-owner.vercel.app`. Preview, localhost, wildcard and other app origins are rejected. CORS is not the identity boundary: every POST also needs a verified Firebase ID token. [Firebase HTTP functions](https://firebase.google.com/docs/functions/http-events)
- POST `/upload` exact JSON: `staffId, group, uploadId, expectedVersion, sha256, clearanceType, expiresOn, base64`. Clearance is `NBI`/`POLICE` only for `clearance`; otherwise it is empty. Group is `valid_id`, `health_card` or `clearance`; expiry is empty or a real ISO day.
- Upload response exact JSON: `storagePath, contentType, size, sha256, alreadyExists`. Fixed path: `staff_private_documents/{uploaderUid}/{staffId}/{group}/{uploadId}.jpg`.
- POST `/download` exact JSON: `staffId, group, uploadId, version, sha256`; response is JPEG bytes with `Cache-Control: no-store` and `nosniff`. Query strings, alternate routes/methods, unknown keys and custom client paths are refused.
- Processed JPEG limit is 2 MiB. Canonical base64, JPEG start/end markers, exact SHA-256, size, token-free exact object metadata and pinned generation are checked. Raw JSON is limited to 3 MiB. This does not perform OCR, prove an ID is authentic or scan malware.

## Authority, versions and retries

Each operation uses `verifyIdToken(token, true)` and live server reads of the enabled version-2 policy, trusted `staff_private_documents/{staffId}` branch scope and immutable approved device binding, or verified Owner/protected `hq_email_access` permissions (`all`/`branches`) and allowed branch. Public profiles, manager records, PINs and credentials are never fetched by a route. No authorization decision is cached across requests. Revocation checking requires the Auth user lookup. [Firebase session revocation](https://firebase.google.com/docs/auth/admin/manage-sessions)

The server checks authority again after GCS IO. Upload also checks expected metadata/version immediately before create and after reading back the immutable bytes. Download requires identical current `files/{group}` and `versions/{uploadId}` records before and after IO, matching the exact requested version/hash/path. A review increments version, so a stale download must refresh. No archived file route exists.

GCS create uses `ifGenerationMatch: 0`; retries with the same ID can use only the exact existing bytes/metadata. Mismatched objects cannot be overwritten. A lost Firestore commit acknowledgement can retry the same upload with its original expected version when that exact upload is already committed; an old operation cannot replace a newer current photo. No `firebaseStorageDownloadTokens`, signed URL, public ACL or `getDownloadURL` operation is used. [GCS create preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions)

The client still commits the current file and version together through existing Firestore Rules and transactions, and HQ review keeps its immutable audit transaction. The broker has no Firestore write permissions and does not bypass these rules. If a device is revoked, policy is disabled, or metadata changes while upload is in progress, create-only bytes can remain as an orphan, but no successful reply or document read is granted. An orphan without committed current/version metadata cannot be downloaded. A separate privileged maintenance process would be needed to remove old/orphan objects; this broker cannot list or delete them.

A final access/version change after the last check cannot retract bytes already sent to a client. Two fresh checks narrow that window and future requests fail, but no HTTP download can guarantee revocation of a previously received file.

## Runtime and IAM: minimum requested grants

Runtime identity: `staff-document-broker@takodeal-pos.iam.gserviceaccount.com`, using attached Application Default Credentials. Do not create or download a service-account JSON key. Separate the runtime identity from the human/deployer/build identities.

| Service | Required runtime permissions | Bound |
| --- | --- | --- |
| GCS | `storage.objects.create`, `storage.objects.get` | Custom role on the exact bucket. No list/delete/update/ACL/signBlob permission. The verified legacy bucket uses fine-grained ACLs, so a bucket-prefix IAM condition is not supported without switching it to uniform bucket-level access. Do not make that broad legacy change for this feature. |
| Firestore | `datastore.entities.get` | Custom read-only role for the `(default)` database. Code reads only config, scope, binding, protected HQ access and exact file/version documents. Standard Firestore IAM does not provide client Rules-style per-collection authorization; the fixed server routes enforce that boundary. |
| Firebase Auth | `firebaseauth.users.get` | Required by revoked-token verification. No Auth create/update/delete, password-hash configuration or secret-read permissions. |

The initial bounded setup uses the two-permission custom role on this exact bucket without an IAM condition. This gives the dedicated account IAM capability to create/get other objects in that bucket; the fixed server prefix, strict routes and lack of list/legacy routes enforce application scope. Review that residual capability explicitly. A separate private bucket or a separately verified supported IAM condition can further limit it, but neither is silently provisioned here.

An object-prefix condition would be suitable only after its support is verified for the chosen bucket/IAM level:

```text
resource.name.startsWith('projects/_/buckets/takodeal-pos.firebasestorage.app/objects/staff_private_documents/')
```

The function uses non-resumable create-only writes and generation-pinned CRC32C streams. Basic Object Viewer/Creator roles include extra permissions, so the two-permission custom role is the smallest permission set requested. Bucket IAM conditions require uniform bucket-level access, which must not be enabled casually on this legacy fine-grained bucket. Firestore direct get/batchGet requires `datastore.entities.get`, without query/list or write rights. [Storage IAM](https://docs.cloud.google.com/storage/docs/access-control/iam-roles), [Storage conditions prerequisites](https://docs.cloud.google.com/storage/docs/access-control/iam-conditions), [Firestore method permissions](https://firebase.google.com/docs/firestore/security/iam), [Auth permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth)

Deployment/build service-agent permissions are separate and depend on the project's existing CI/organization policy. The approved deployer must be able to deploy a gen-2 function, act as the dedicated runtime account, and use the normal Cloud Build/Artifact Registry service agents. Do not grant runtime Owner, Editor, Storage Admin or Firestore User as a shortcut. Firebase, Functions, Cloud Run, Cloud Build and Artifact Registry prerequisites and Blaze billing must be verified before provisioning; no live IAM was changed by this implementation.

The HTTP invoker is public because browser Firebase ID tokens are checked by application code rather than Cloud Run IAM OAuth. It does not permit unauthenticated file access. Production must not be configured with Auth/Firestore/Storage emulator endpoints. Node 22 runtime is configured with 256 MiB, fractional `gcf_gen1` CPU, one request per instance, min 0/max 2 instances and 30-second timeout. These are scaling bounds, not a hard spending cap; requests, builds, reads and bandwidth can still incur cost. [Firebase runtime/scaling](https://firebase.google.com/docs/functions/manage-functions)

## Concrete release sequence

1. Keep `staff_document_config/current.enabled = false`; do not load real IDs during setup.
2. Install the pinned compatible SDKs, generate/review `package-lock.json`, run dependency audit and real wrapper import without making a cloud request. The official registry check on October 9 verified `firebase-functions` 7.4.0 supports Admin 14; the final pairing is Functions 7.4.0 / Admin 14.5.0. It replaces the initial compatible older pair because its transitive dependency audit reported a moderate advisory. No forced peer install or dependency override is used. [Functions peer range](https://github.com/firebase/firebase-functions/blob/v7.4.0/package.json), [Admin package](https://github.com/firebase/firebase-admin-node/blob/v14.5.0/package.json)
3. Provision/review the dedicated account and grants above. Verify the final private prefix has no effective public IAM/ACL access; retain legacy public paths only as approved. Remove/revoke the old synthetic token-bearing object separately. A token-based legacy file is refused by this broker even if its token value is empty.
4. Publish reviewed Firestore version-2/exact-endpoint policy rules and **deny all client Storage reads/writes/metadata/listing** for the private prefix. No other client Storage rule may overlap and grant it. This is essential so the Firebase client API cannot mint a token.
5. Review final exact source/dependency hashes and bind the five deployment files to `private-broker-reviewed.json`; record the reviewed commit. The local helper refuses a missing manifest, changed file, missing lock, wrong runtime/dependency versions or failed real SDK import. It never reads credential/config files.
6. After separate concrete cloud approval, run `Deploy reviewed TAKODEAL private broker.cmd --deploy`. The helper uses the existing official Firebase CLI, fixed project and isolated `firebase.broker.json` with only `functions:staff-documents`. It does not publish app code, Rules or IAM, and does not enable the vault. If CLI needs authentication, use its ordinary browser login as the approved Owner; never paste/extract a token or key.
7. Deploy reviewed Staff/Owner client adapters and their cache updates. Check the enabled-device directory before testing: approve only a clearly labelled synthetic employee/device, with no real employee binding. From an exact approved production app origin (localhost and previews are deliberately rejected), the verified Owner may temporarily enable the version-2 exact-endpoint policy for this controlled pilot. This is a global switch, not a separate per-employee test mode; do not enable it if any real binding is active.
8. Verify synthetic authenticated upload + atomic Firestore commit + current download; then revoke the synthetic device/HQ scope and require rejected reads. Anonymous GCS GET, Firebase token/metadata APIs and no-token broker calls must fail; check exact CORS, scale/service identity and absence of token metadata with the deployed SDK. Disable the configuration and retire the synthetic approval after the pilot. No real IDs are used in these checks.
9. Only after the live checks pass may the verified Owner enable the policy for real staff and approve their individual devices. Rollback disables the policy first and keeps the private prefix fully denied. Never restore a permissive private Storage rule to repair another feature.

`--check-only` performs no cloud action and requires the final reviewed manifest/dependencies. The pure tests use fake Auth/Firestore/GCS, and the actual wrapper tests use API-compatible SDK seams; they prove semantic/lifecycle behavior, not real cloud IAM, routing, installed SDK compatibility or billed cost. Those remain explicit deployment checks.

Local verification on October 9: 40 broker/core/wrapper/release-gate/SDK-check cases passed. The exact registry SDKs (Admin 14.5.0 / Functions 7.4.0) are installed with a version-3 lockfile. The committed `tools/private-broker-sdk-check.mjs` imports the real wrapper with HTTP/HTTPS/fetch/socket/TLS/DNS/subprocess calls and known ADC/config credential-file reads blocked; its real SDK endpoint describes the limits above. Both local Node executables report 24.21.0, while the deployed package engine is 22; CI must run `npm ci --prefix functions/staff-document-broker` then `node tools/private-broker-sdk-check.mjs` under Node 22. This import did not request an ADC token or call Firebase/GCS. The check-only deploy helper currently refuses deployment because the final reviewed commit/hash manifest has not yet been issued; that manifest must be created after final source review/commit, rather than invented from the baseline commit.

Example final manifest shape (hashes/commit must come from the final reviewed source; do not fill placeholders):

```json
{"schemaVersion":1,"project":"takodeal-pos","codebase":"staff-documents","reviewedCommit":"<40-hex reviewed commit>","files":[{"path":"firebase.broker.json","sha256":"<64-hex>"},{"path":"functions/staff-document-broker/broker.mjs","sha256":"<64-hex>"},{"path":"functions/staff-document-broker/index.mjs","sha256":"<64-hex>"},{"path":"functions/staff-document-broker/package.json","sha256":"<64-hex>"},{"path":"functions/staff-document-broker/package-lock.json","sha256":"<64-hex>"}]}
```
