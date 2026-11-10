# Verified Owner desktop Cashier actions

This additive server cohort is based on live `fe8c6184a4ddca1f5dca14ef7cf3d7fd3953cea6`. It creates no device approval/binding and changes no registration, Rules, IAM, normal Cashier identity, financial source model or historical stock proof.

The provider determines authority; no client mode flag grants access. A revoked-checked verified Google Owner token must match the canonical Owner email and any saved source UID. Fresh, unambiguous HQ authority must be active under the canonical lifecycle and both PIN/securityPin revocation markers. The physical device must have one Active non-Staff Main Office registration. The selected working branch must be one active saved branch. These sources are read again in the same Admin transaction for each protected action. A bounded ambiguity or mismatch holds; it never falls back to anonymous authority.

The existing `/access/staff-login` request and six-field response remain unchanged. The exact selected employee PIN must succeed. For Main Office Owner desktops the server writes a private `ownerDesktopAuthority` audit into that employee session: schemaVersion, mode, Owner UID, registration ID, registration branch and working branch. Home branch and selected working branch remain distinct. The physical registration stays Main Office. Ordinary anonymous device gates remain unchanged.

Void accepts this verified Owner provider only with the same current employee/session/profile revision, matching server-issued desktop audit and fresh desktop authority. Existing current-shift, source, stock, counter, quote, idempotency, reversal and replacement-claim checks remain mandatory. The operation is keyed by the actual token UID and audits that Owner identity. Owner mode does not adopt anonymous operations: old UID journals and paid claims retain their IDs and namespace. Cancellation in another UID can only create its own tombstone.

Cashier prep reuses the same audited Owner desktop session, including protected Skip reviews. Its existing exact-branch Owner path and normal anonymous path remain unchanged. No public prep notification is added.

The client must use its already retained primary or fixed Owner-preview Google credential with a matching Firestore instance, without replacing/signing out normal identity. Correction-only financial SDK writes must use that same captured context. The existing legacy receipt/commit protocol does not attest Firebase creator UID; full-payload broker ACK is not represented as a new cryptographic writer proof. The broader offline-authority upgrade remains stopped.

Local gates use fictional memory data at concurrency1. Actual Admin tests are prepared for credential-free hosted execution only: `tests/owner-desktop-admin.emulator.mjs`, `TAKODEAL_TEST_TOOLS`, loopback8876 and `demo-owner-desktop`. Do not run local Java/full suites while the user uses the PC. Root owns CI, deployment and live verification.
