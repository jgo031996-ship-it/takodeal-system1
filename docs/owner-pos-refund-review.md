# Owner POS configuration and online order incident review

The Owner app is served from `takodeal-manager`; “Manager app” in earlier release notes meant this Owner app.

## POS Config Hub

- Purchased Cancelled Orders has its own section and discount. It uses the existing `cancelledFoodPurchaseEnabled` and `cancelledFoodDiscountPct` keys, independent of Staff/Leadership meal levels and the daily allowance.
- Keep `pos-config-section` on the dynamically rendered editor. The existing section router hides every unselected panel, including after a save, reload or catalog refresh.
- POS Lists & Categories uses individual editable rows. Add from saved item/category choices or enter a new option once. Case-insensitive duplicates and oversized lists are rejected. Opening the editor never writes defaults.
- Unsaved settings survive row edits and catalog arrival. The existing configuration revision prevents overwriting another Owner editor’s save.

## Cancelled-food purchase eligibility

Active registered crew and managers in operational employee profiles (`cashiers`) may purchase a prepared cancelled Grab/Foodpanda order using their login PIN. Their private Pay PIN is different. Support string/numeric login PINs and the existing `securityPin` fallback only when `pin` is absent or empty. Do not query the protected HQ administrator directory from a PIN-only Cashier device.

Fresh employee ID, canonical name, PIN, status, source receipt, active shift, discount and atomic receipt/deduction linkage remain checked. Duplicated login PINs are refused. Purchase is permitted across employee home branches; the existing transaction remains scoped to the selling branch and open shift.

An Owner-approved binding is still required for protected sales or customer-order gate branches. The anonymous legacy Cashier path is permitted only when both branch protections are off and the UID has no binding. Existing revoked/other-branch bindings cannot use that compatibility path. The validated purchase path must stay below Firestore’s expression and document-access limits; do not reintroduce repeated full validation on every companion write.

## Online Order Refunds — pending review only

Grab and Foodpanda sales cards open searchable orders from the loaded Sales History report. Receipt Details offers “Refunded or complaint incident.” A verified Owner selects an active employee by ID and records the reason, incident details, platform evidence/reference and actual confirmed refund amount. Unconfirmed complaints have zero actual refund. The refund cannot exceed the saved receipt total.

The deterministic `online-refund-{sourceSaleId}` record creates an Owner-only `online_order_incidents` case and one linked employee history record in `staff_deductions`. It does not modify the original sale, stock, shift settlement or platform payout, and it does not issue a platform refund. Closed paid orders may be reviewed; archived orders missing from the live database need archive reconciliation. Prepared cancellations keep their separate purchase workflow.

The user expressly selected **Keep charges pending review**. New records have `status: Pending Review`, `amount: 0` and `proposedAmount` equal to the recorded actual refund. They appear in Master Employee Profile history and the employee’s unlocked Pay view under Online Order Refunds. The payslip adds the ONLINE REFUND ORDERS box at zero. No net-pay reduction or automatic charge approval is enabled in this release. Existing paid payroll figures are retained.

The Owner records the staff response and review note, keeps the case pending or dismisses the charge. Private evidence and free-text responses remain in the Owner-only case; only status and response-recorded confirmation go to the existing deduction feed. Deletion and conversion of these pending cases to payable/paid charges are denied, including direct Owner writes. Financial approval and recovery after review require a separately reviewed payroll implementation and user instruction.

Philippine wage deductions require a lawful basis; a customer complaint is not automatically one. Applicable responsibility, opportunity to respond, actual loss and deduction limits must be reviewed before any future collection. Reference: [Omnibus Rules implementing the Labor Code, Book III](https://natlex.ilo.org/dyn/natlex2/natlex2/files/download/77583/PHL77583.pdf). The app does not establish that an order-error charge is legally permitted.

## Verification

Unit/transaction tests include concurrency, lost acknowledgement, rollback, stale review, amount validation, role/PIN compatibility, existing payroll calculations and XSS escaping. The local demo-only Firestore runner uses the full candidate rules and tests protected/legacy devices, revoked/scoped accounts, cross-branch buyers, paired incident writes, pending-only charge enforcement and dismissal. No production records are written during testing.

`tests/build-owner-refund-qa.mjs` builds synthetic 320/390px review screens from the actual config, section-router, incident, employee lookup and Staff Pay modules. It uses in-memory transactions and blocks outbound connections. The generated screens are excluded from the release tree. Service-worker versions are bumped without clearing offline receipt/outbox stores.

Existing platform refund accounting, public legacy operational collection reads, private-document broker configuration, general payroll disbursement atomicity and the temporary inventory exception setting are outside this release.
