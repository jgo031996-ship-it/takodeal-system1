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
publish rules. On October 3, 2026, the owner authorized publication of the prepared
rules. Firebase confirmed successful publication, and the two held receipts
subsequently uploaded from the original Cashier without re-entry.

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
The Firebase Console Rules Playground was subsequently available on October 3,
2026. Its draft simulation accepts both exact held receipt marker reads with
authentication off and denies sale-marker deletion. The marker read now checks
`resource == null`, using the document already requested rather than a separate
`exists()` lookup. The simulator had reported an evaluation error for the extra
lookup; the direct check permits the intended missing-marker read.

## Live publication and recovery verification

The owner authorized publication on October 3, 2026. The editor contents matched
the exact tested draft before Publish was clicked. Firebase confirmed successful
publication in takodeal-pos / (default).

The original Main Office PIN-only Cashier automatically recovered both receipts:
- 20261003-0002-E6172262: Cash, net total 125, commit at 18:28:59 UTC+8.
- 20261003-0001-1FA05B83: Salary Deduction, net total 70, commit at 18:29:02 UTC+8.

Each has its original permanent sale ID, one corresponding pos_sale_commits
document, inventoryState "applied", and statsApplied true. Both appear once in
live Shift Sales after Refresh Sales; the saved-local badge cleared. The latest
captured permission-denied message predates the successful commits.

Before publication, 181 Main Office inventory balances were captured through the
Firebase Console. After recovery, all 12 changed inventory records matched the
sum of the two receipts' recorded inventoryMovements exactly. No unrelated stock
records changed. A later reread of all 181 records, after further retry cycles
and Refresh Sales, found no additional stock changes.

Some inventory balances were already zero or negative before publication.
Recovery applies the configured recipe quantities and does not correct existing
stock counts or recipe configuration. Manager's live UI has not been inspected
in this publication session; filter its Sales Transactions to Main Office and
October 3, 2026 to locate the same receipt numbers.

These live checks cover the two held Main Office sales. They do not replace a
full emulator/staging role matrix, protected-branch rollout tests, or live
Audit Mode/void tests. No additional orders were entered, and no browser sales
storage was cleared.

References: https://firebase.google.com/docs/firestore/security/test-rules-emulator
and https://firebase.google.com/docs/firestore/manage-data/transactions.
