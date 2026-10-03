# Cashier sale and inventory safety repair

Starting revision: `6b77721` on `jgo031996-ship-it/takodeal-system1/main`.

## Changes, in audit priority order

1. **Sale retries:** Checkout creates a permanent cryptographic sale ID. The shared IndexedDB outbox acknowledges a sale only after Firestore confirms it. One Firestore transaction creates `transactions/{saleId}` and `pos_sale_commits/{saleId}`, changes every ingredient stock balance, increments both milestone counters, and records delivery/mobile payment, discount and meal effects. A repeated ID is checked against a canonical fingerprint and never repeats effects. Keep commit markers permanently, including when receipt history is archived.
2. **Multiple tabs:** IndexedDB transactions serialize queue inserts, claims and updates across tabs. A sale has an expiring claim so another tab can recover after a crash. Acknowledgement deletes only its ID, preserving concurrently appended sales. Web Locks serialize the sync loop where supported; database idempotency protects overlapping claims after expiry or across devices. Mobile orders additionally share a deterministic identity and an atomic check of their source payment status.
3. **Audit Mode:** Sales record their exact ingredient document IDs and quantities. Paused sales commit as `inventoryState: deferred` without modifying stock. Branch audit state is shared at `settings/audit_{encodedBranch}` and observed by cashier clients. Resume applies each sale's saved deductions and changes its state atomically. Retry, two resumes, and a simultaneous void cannot apply a movement twice. Audit toggling requires a working connection; offline customer checkout continues to queue normally. Owner-reviewed shift settlement also recognizes the new deferred state and requires its audit to finish first.
4. **Parked deletion:** Delete, the accountability receipt and the manager alert commit together under a deterministic ID. No stock is added for an unpaid parked order. Confirmation and success wording now describe that behavior.
5. **Voids:** Both Cashier and Manager void paths use the same engine. The transaction rechecks receipt status and branch, returns only the recorded movements, reverses global and branch counters, writes stock logs and alerts, and marks the receipt Voided together. A deferred sale is cancelled without adding stock. A second void does nothing.
6. **Duplicated functions:** Removed 14 shadowed function definitions. Retained the final effective mobile toggle, shift-open, printer reconnect, sanction and universal signature implementations. Signature aliases still use the universal pad. Standard and schedule announcements now have explicit separate entry points. Waste uses the existing photo/UOM conversion and Manager approval flow; the overriding direct-stock-deduction version is removed. Waste submission has a click lock and retains its request ID across retries without resetting an existing approved request to Pending.
7. **Checkout outcomes:** `processCheckout` returns an explicit queued result only after the local storage transaction completes. A validation/storage failure returns failed and the cashier keeps the cart. It never invents an OFFLINE receipt on failure. Related cloud writes no longer block the receipt UI while offline. The sale captures cart and available recipe data before queuing; later cart changes cannot alter it. Zero-value authorized meals remain zero.

Layout, payment controls, receipt printing, item order types, add-ons, fractional Dine-In packaging and cashier attribution are retained. Safety messages change only where necessary.

The Cashier service worker has a new core version and caches both new modules. The Manager worker likewise caches its safety module. Manager has a byte-identical copy because apps can deploy from separate Vercel roots; the Cashier file is canonical. After editing it, run `node scripts/sync-sale-safety.mjs`. The tests enforce equality.

## Existing data and rollout

The old engine could partially save a sale or deduct stock without a sale document. Its anonymous audit queue could also partially apply. Neither queue contains enough evidence to determine what already happened. The repair **preserves** `takodeal_offline_queue` and `takodeal_audit_queue` unchanged, flags old sales for review, and does not replay them automatically. New sales use a separate durable outbox and can continue.

Older receipts without verified movement metadata cannot be safely replenished from today's recipes. Both void interfaces refuse them with a reconciliation message, leaving sale and stock unchanged. Reconcile those receipts and old queues against receipt/payment evidence and stock counts before manual correction. No migration or inventory correction is automatically invented by this patch.

Deploy the Cashier and Manager changes together and reload all clients so old cached code cannot continue bypassing the new guards. Preserve browser storage during that update. Complete pending audits before archiving their sale records; permanent `pos_sale_commits` records must not be purged.

Firestore rules are absent from this repository. Before production rollout, test the authenticated cashier and manager roles against a staging database and verify access to the new commit markers, branch audit settings, and every document involved in each transaction. Required operations are marker create/read, transaction create/read/update, inventory read/update, settings read/write, related alert/request/order create or update, parked order read/delete and stock-log create. Appropriate authorization and immutability rules must remain in force. This patch does not install or relax database rules.

Vercel production settings, real Firebase rules, real stock balances and live database behavior have not been verified. The proposal is a draft code repair, not a production deployment or a correction of existing duplicate sales.

## Verification

37 targeted checks passed: 23 transaction/source checks and 14 real browser checks. JavaScript syntax checks and Git whitespace checks also passed.

Run the transaction and source checks with Node 22 or newer:

```text
node --test tests/pos-safety.test.mjs
```

Real browser outbox checks require Playwright and an installed Chromium/Edge browser:

```text
node --test tests/outbox-browser.test.mjs
```

Set `PLAYWRIGHT_MODULE_PATH` to an installed Playwright package if it is outside normal module resolution; set `POS_BROWSER_EXECUTABLE` to the browser executable when using an existing Edge installation. No Firebase connection or production credentials are used by these tests.

The transaction harness stages writes, tracks document read versions, retries contention, rejects reads after writes, and injects failure before commit and lost acknowledgement after commit. Checks cover 20 retries, two sale clients, branch isolation, exact BOM/add-on/packaging quantities, permanent markers after receipt archival, canonical fingerprints, audit retries and races, void retries and races, parked deletion rollback, and stable delivery/meal/discount effects. Real browser checks cover two tabs, concurrent enqueue/claim/acknowledgement, expired claims, reload persistence, unavailable storage, quota errors, frozen sale data and safe checkout outcomes. These establish application behavior in controlled tests; staging verification remains necessary for the actual rules and SDK/database deployment.

The implementation follows Firestore's transaction requirements: reads before writes, no application-state changes inside callbacks, whole-transaction retry under contention, and local queuing while offline. See [Firebase transactions documentation](https://firebase.google.com/docs/firestore/manage-data/transactions).
