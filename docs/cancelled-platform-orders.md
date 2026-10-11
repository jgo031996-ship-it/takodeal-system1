
# Prepared platform cancellations and staff purchases

This flow handles a Grab or Foodpanda receipt whose food was already prepared and whose customer or rider subsequently cancelled. It does not contact either platform, issue a refund, change a platform payout, or assume that a cancellation qualifies for compensation.

## Record the cancellation

Use the prepared-order action in Cashier Shift Sales and choose **Prepared but customer cancelled** or **Prepared but rider cancelled**. The engine receives reason `customer` or `rider` and records a separate `preparedCancellation` marker on the original receipt.

The original receipt uses the existing non-revenue status `Voided` so ordinary revenue summaries exclude its platform amount. Its receipt identity, timestamp, original cart, amount and immutable sale-commit fingerprint remain available for audit. This is different from the normal stock-returning void: prepared cancellation does not return consumed ingredients to inventory. Applied movements stay applied; deferred movements remain attached to the original receipt and are applied once when its inventory audit resumes. Unresolved ingredient links remain available for HQ review.

New cancellation requires the source receipt's verified sale marker, the matching branch and an open active source shift. Older receipts without verified movements/identity need HQ reconciliation. A closed shift's saved totals, cash/account sweeps and royalties are not silently rewritten. Cancellation changes the shift's sales revision so a close calculation made before the cancellation must be refreshed.

## Optional staff purchase

The staff purchase uses the entire saved original order once. Cashier reviews a fresh price quote and verifies the purchasing employee's current PIN before confirming. Manager POS Config stores:

- `cancelledFoodPurchaseEnabled`: whether this purchase option is available; default `true`.
- `cancelledFoodDiscountPct`: percentage discount for the saved order; default `20`.

The quote uses the recorded gross subtotal when present, otherwise the recorded net amount. Amounts are rounded in cents. A changed order or policy requires a new quote; a disabled purchase option still permits recording the prepared cancellation.

A successful purchase writes one linked `Salary Deduction` receipt and one direct `Unpaid` `staff_deductions` entry of type **Cancelled Food Purchase**, categorized as **Foods** in payroll. It does not also create a pending meal approval request. The deterministic purchase and deduction identity is `cancelled-food-<encoded source sale ID>`. The deduction retains the original source receipt/platform, purchasing staff ID/name, discount and charged amount. PINs are not included in receipts or deductions.

The new purchase receipt has no inventory movements. Original ingredients are consumed once, platform revenue is excluded once and only the discounted staff-purchase revenue remains. The ordinary void cannot undo this linked purchase while leaving its payroll charge behind; corrections need HQ reconciliation. Existing paid payroll snapshots remain unchanged.

## Retry and verification

The transaction checks the source receipt/marker, branch, shift, current configuration, current Staff identity and captured Cashier session before new writes. Cancellation, purchase, audit records and relevant counters use stable identities. A lost acknowledgement can retry the same intent without another inventory movement, receipt or salary charge. A different buyer, reason or quote cannot receive an acknowledgement for another operation. A completed purchase can be acknowledged after the source shift closes without creating a new purchase.

When a purchase response fails, the app makes one read-only acknowledgement check, bounded to five seconds. It acknowledges only the original source link, staff identity, frozen quote, receipt and matching deduction. Missing, changed or inaccessible records retain the original error. This check never retries a financial write.

`tests/cancelled-platform-orders.test.mjs` runs the actual cancellation and sale engines against an optimistic in-memory Firestore harness. It checks concurrency, rejected commits, lost acknowledgements, source/identity/quote conflicts, closed shifts, audit resume, payroll Foods classification, revenue exclusion and preservation of balances. These are synthetic tests; they do not create real staff, receipts, deductions or inventory changes.

Protected-sale branches also require the narrowly validated Firestore policy changes for this flow. Client-side UI checks alone are not an additional server authorization boundary.
