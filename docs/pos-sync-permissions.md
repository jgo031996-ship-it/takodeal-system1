# Recover saved sales after the permission-denied report

The reported badge tooltip was "Missing or insufficient permissions." The owner
confirmed two separate test checkouts. The supplied live policy has no match for
`pos_sale_commits`, which the new sale engine reads before creating a receipt.
New sale uploads therefore fail at that read. In a PIN-only session, the existing
signed-in-only `settings/global_stats` rule can reject the atomic counter write as
well. Protected branches also expect the older localSaleId/syncVersion schema and
audit_pending transition. These are policy/code compatibility issues; do not
re-enter the held orders or clear browser data.

This proposal adds marker rules with immutable markers and same-transaction
receipt validation. It retains existing branch policy and account permissions.
Protected branches still require their approved anonymous UID or verified HQ
access. It adds the current sale and audit/void states alongside legacy ones.
PIN-only unprotected-branch counter updates require matching receipt/marker
documents, exact counter deltas, and the first sale or first void transition.
The client records the originating sale on counter writes. Audit settings writes
are limited to branch-matched audit IDs, fixed fields, and the existing sale actor
policy. Parked deletion writes its original parked ID so its protected-branch
accountability receipt can be verified with the same deletion.

The complete `firestore.rules` is based on the policy supplied in this chat;
comments/spacing were condensed. Unrelated collections retain the same clauses.
There is no Firebase deployment configuration and merging this PR does not
publish rules. No production data or live rules have been changed by this work.

Cashier Shift Sales now reads the new IndexedDB outbox, scopes rows to the branch
and shift, deduplicates against server receipts, shows pending/error status, and
excludes pending rows from confirmed digital totals and server-only actions.
Errors persist outside the receipt payload and are safely displayed. The badge
can be clicked for each pending receipt's reason. The receipt labels local
acceptance separately from upload and update when the background upload finishes.
Manager floating buttons remain disabled by the owner's main.js edit.

## Publication order

1. Save a backup of the actual currently published Firebase rules.
2. Review and merge the Cashier/Manager module update and wait for both production
   deployments. Reload all clients using the cache-only Force System Update,
   preserving IndexedDB/localStorage. Older clients cannot perform the new
   PIN-only counter write without its originating-sale metadata.
3. Validate the proposed complete rules in Firebase's compiler and in an isolated
   emulator/staging project. Publish in the actual takodeal-pos Firestore Rules
   editor only after validation. Do not change Storage/Realtime Database rules or
   replace the policy with a blanket allow rule.
4. Keep the original Cashier online. The automatic retry runs every 15 seconds.
   Confirm the two original receipt numbers upload, the new pending count clears,
   each receipt has one commit marker, and each recorded ingredient is deducted
   once. Manager must show these same receipts for Main Office/date/shift.
5. A branch with `offline_policy/<branch>.protectSalesV2 == true` still requires
   the existing approved Firebase UID/HQ path; a staff PIN alone cannot satisfy
   that rule. Resolve the approved device session instead of disabling policy.
   Legacy queues and receipts requiring reconciliation remain held.

## Verification limits

44 controlled checks pass: 27 transaction/source/pending-row checks and 17 real
browser/IndexedDB checks. New cases cover permission rejection, retaining two
receipts, recovering each once, pending-list deduplication/branch/shift isolation,
escaped errors, confirmed totals, and receipt acceptance/upload labels. They use
the application engine and a transaction harness, not a live Firebase database.
The actual Firebase rule compiler/emulator and live roles are not available in
this workspace. The proposed rules require Firebase compilation and real SDK
permission tests before production publication. Rules syntax/reference review
and structural checks are not substitutes for that validation.

References: https://firebase.google.com/docs/firestore/security/test-rules-emulator
and https://firebase.google.com/docs/firestore/manage-data/transactions.
