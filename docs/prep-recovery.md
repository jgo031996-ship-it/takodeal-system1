# Exact prep reference recovery

Base: `b206f51d7963925ea9bc34825d46b4a39bb782ad`. Only `prep-handler.mjs` and `prep-store.mjs` change runtime behavior; the cash function closure remains 64 tracked JS/MJS/JSON files. No application, router, Rules, IAM, dependency or stock-planning changes are included.

## Routes

All routes use the existing revoked-token check, approved origins, bounded JSON and UID rate limit. Owner actions require verified Google Owner plus fresh canonical HQ authority, full active lifecycle and both PIN revocation markers. Cashier status requires its current approved UID/device/profile/branch and current valid staff session.

- `POST /prep/status`: Owner `{operationId}`; Cashier `{operationId,cashier:{staffId,deviceId,sessionId}}`. The current SID may differ from the original solely for this read. Original UID, staff, device and branch must match. No new SID can adopt the old quote's commit authority.
- `POST /prep/recovery-close`: Owner only `{operationId,expectedRecoveryFingerprint,requestId,reason}`. A fresh conditional fingerprint closes this exact unposted reference. Saved stock or a saved skipped issue wins a race and is returned honestly. Entirely unknown UUIDs may be explicitly sealed with no invented source/actor; an unknown read alone is never non-save evidence.
- `POST /prep/review-resolve`: Owner only, same four keys. A saved skipped issue can receive an immutable `ReviewedNoStock` decision. It does not approve production, post stock or mutate the original historical issue.

The status object has exactly eleven keys: `schemaVersion`, `operationId`, `state`, `terminal`, `stockPosted`, `canCommit`, `recoveryFingerprint`, `source`, `quoteClosed`, `reviewed`, `reversed`. `canCommit` is always false. `recoveryFingerprint` is server-derived and opaque.

`source` is null or exactly `{branch,outputInventoryId,outputName,qty,intentHash,actorFingerprint}`. The intent hash uses recursively sorted `prepCanonical({outputInventoryId,qty,reason:reason||''})`. The original Cashier actor hash uses `prepCanonical({actorUid,staffId,deviceId,sessionId})`; the original SID is hashed, never returned. Owner-origin prep uses `{actorUid}`.

| State | terminal | stockPosted | source | Other flags |
| --- | --- | --- | --- | --- |
| saved | true | true | required | reviewed false; reversed may be true |
| skipped | true | false | required | reversed false; reviewed may be true |
| closed | true | false | required, except sealed unknown UUID | quoteClosed true; reviewed/reversed false |
| pending | false | false | required | reviewed/reversed false; old quote may be closed |
| unknown | false | null | null | quoteClosed/reviewed/reversed false |

## Atomic and rolling-version boundary

The transaction reads the exact operation, skipped review, quote, closure, resolution and reversal. Contradictory or malformed private records hold for review. Closing never invokes stock/log/money/shift/count mutation methods. The private closure preserves original source/actor evidence when known. A private no-stock resolution preserves the original issue fingerprint and first Owner decision.

An existing quote is atomically sealed with a reserved nonfinancial closed kind. Its original plan/intent/actor fields stay unchanged, and the complete original quote is preserved in the private closure. Only the paired private recovery reader reconstructs the original kind to validate that proof. The old b206 parser rejects the new kind before commit or skip, including the old skip path that ignored ordinary closed status. Ordinary expiry/skip quote-closing behavior is unchanged.

If no quote exists, closure creates a strictly nonfinancial `prep-recovery-closed-quote` sentinel at the same quote document ID. It has no plan or intent. The exact old b206 parser rejects that kind; its existing quote read/create precondition prevents an in-flight old preview from overwriting it. The new recovery reader accepts either closed variant only with the exact matching private closure. New financial routes also read the closure before preview, commit or skip. Racing commit/skip either wins as Saved/Skipped or loses to closure; stock or a conflicting skipped record cannot be posted after a successful closure.

`prep_recovery_closures` and `prep_review_resolutions` remain default-denied under active Rules. No public manager alert is written. Reasons, actor audit and source evidence stay in private server records.

## Limits and validation

Unknown status, network failure and stale session never authorize deleting a local reference. Explicit Owner closure only seals an ID; it cannot establish whether a physical batch was already counted. `ReviewedNoStock` is appropriate for documented no-post handling; actual new production remains a separate fresh prep after recipe/raw-stock correction. No backdating, negative raw consumption, quantity/recipe repair, stock approval or automatic posting is introduced.

Local lightweight checks: 20 recovery tests; 24 existing prep-review service tests; seven current and historical inverse/boundary checks. Hosted-only prepared gates: `tests/prep-recovery-admin.emulator.mjs` (20 actual Admin cases, port 8882) and `tests/prep-recovery-private-rules.emulator.mjs` (two active Rules cases, port 8883). They use the existing `TAKODEAL_TEST_TOOLS` runtime; the Rules gate also requires `PREP_RULES_FILE`. No local Java/full suite or production business write was run for this candidate.
