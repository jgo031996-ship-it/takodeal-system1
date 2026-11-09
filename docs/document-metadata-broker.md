# Private document metadata gateway

The image broker remains Firestore read-only and keeps its existing GCS create/get permissions. Metadata writes use the existing `cash-remittance-review` identity and its existing Firestore get/list/create/update permissions. This change needs no new IAM role, key, delete permission, grant or collection of personal credentials.

The fixed gateway is `https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/document-metadata`. Only the canonical Staff and Owner origins are accepted. Upload requires the approved private anonymous UID; review requires a verified Google HQ account. Each request verifies the Firebase token with revocation checking before inspection and after object IO. Every final transaction rechecks the enabled V2 private policy, immutable employee scope, current active staff profile, and exact private binding or fresh HQ source/index/optional bridge intersection. HQ PIN revocation markers and current branch permissions are checked even when the protected index has not yet synchronized.

Both routes accept exact JSON and require a Firebase bearer token:

- `POST /upload`: `staffId, group, uploadId, expectedVersion, sha256, size, clearanceType, expiresOn`.
- `POST /review`: `staffId, group, uploadId, expectedVersion, sha256, reviewId, status, note`.

Successful acknowledgments contain only `staffId, group, uploadId, version, alreadySaved`; review also returns `reviewId, status`. No profile, credential, object bytes or reusable URL is returned. Unexpected SDK/transport errors produce a generic 503; only branded, reviewed metadata errors retain their safe status/message.

For upload and approval, the gateway itself forwards the **original** Firebase bearer only to the hardcoded `staffDocumentBroker/attest` HTTPS endpoint, with the verified canonical Origin. Redirects are refused, the complete operation is bounded to 20 seconds, and JSON is capped at 8 KiB. A caller-supplied URL, object path or attestation is never accepted. The image service freshly reauthorizes, derives the path, verifies exact token-free object metadata, generation-pinned size/JPEG/SHA-256 bytes, then reauthorizes and checks state again. It writes neither Firestore metadata nor GCS bytes in this route.

Upload commits the unchanged legacy 16-field head/version pair atomically. Review changes only the existing status/review/version fields, updates the same immutable-upload version, and creates the existing nine-field audit. The pair must agree. Original update times participate in the internal inspection fingerprint, so restoring the same data after an intervening change does not bypass the stale-head hold. Same-operation retries return the committed result without changing timestamps or adding a version/audit. Older operations cannot restore an earlier current photo.

Approvals retain the existing client requirement to open and decode the exact current private photo within five minutes, plus full server byte attestation. This UI proof does not claim to prove that a human read an image. Rejection with a bounded reason deliberately skips object attestation: an unavailable/corrupt image must remain rejectable. Fresh HQ authority and exact head/version/audit checks still apply.

Staff and Owner use identical `document-metadata-client.js` and `staff-document-store.js`. Browser SDK reads and the device request transaction remain; file/version/review writes have no SDK fallback. Failed upload retries retain the image operation ID. Failed review retries retain their exact review intent ID while that store instance remains open. A local account change before dispatch prevents the request; an already-authorized server commit may complete after navigation, and its late UI acknowledgment is refused rather than falsely claiming rollback.

Integration adds the metadata handler/store and attestation factory to the existing cash gateway and routes `/document-metadata/` to it. No image wrapper change is required. Both service workers cache the new client module; the release integrator owns version bumps. Deploy the image service and metadata gateway before publishing the clients. Retire only child file/version/review SDK writes after the migrated flows are verified. Config/request/device approvals, private root profiles, reads and protected financial acknowledgments remain separate.

Warm-instance UID/IP/request limits bound repeated checks; they are not a global spending cap. GCS and Firestore are not one atomic transaction. An interrupted operation can leave immutable unreferenced bytes, and this service has no delete capability. Existing download revocation limits still apply to bytes already received by an authorized client.
