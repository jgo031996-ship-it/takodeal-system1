# Owner compliance records

Open **Government & Compliance** in the Owner sidebar for branch permits and bookkeeper payments. Open a saved employee in **Staff & Security → Advances & Deductions History** for SSS deductions and remittance records.

## Permits

Each permit records its branch, type, name, agency, number, issue and expiry dates, renewal progress and notes. Unknown dates remain blank. The chosen reminder window uses the entered expiry date; no statutory deadline or renewal date is invented. Renewed permits need their new dates entered explicitly.

Edits use a revision check and atomically append an immutable before/after history entry. Archive and restore preserve earlier changes and documents. A browser-tab change preserves an unfinished form; leaving the route or changing account invalidates the old editor.

## SSS

Saved paid payroll and government remittance are separate facts. The history reads frozen SSS deduction amounts from paid payroll snapshots. It never reconstructs a historical deduction from the employee's current recurring rate. Incomplete or ambiguous legacy snapshots are shown for review.

An actual remittance record contains the contribution month, remittance date, payment reference, employee allocation, employer and EC amounts, notes and optional proof. Up to two payroll cutoffs can be linked in one record. Partial allocations are allowed. An atomic allocation ledger prevents recording more than the saved employee deduction, including concurrent devices. A stable reference makes retries idempotent. Different contribution months can share a bulk-payment reference; each month remains a separate record.

Recording a remittance does not deduct payroll again, change a bank balance or confirm government posting. Contribution rates and liability are not calculated by this feature.

## Bookkeeper payments

Record payments already made, including payee, branch or company-wide scope, service month, amount, payment date, method, receipt/reference and notes. The normalized payee/month/reference identifies an immutable record and prevents duplicate retries. This is a payment log; it does not transfer funds or post another expense to existing accounts.

## Private supporting documents

PDF, JPEG and PNG files up to 2 MiB are stored in Owner-only Firestore document chunks. Record and file writes commit atomically. Lists contain only metadata; files load on demand with bounded reads and SHA-256 checks. Download links use temporary local blob URLs, not public Storage links. Generic Managers, POS devices, Staff and signed-out clients cannot read these collections or documents. Only the existing verified Google system Owner may access them.

Application collections: `government_permits` (with immutable `changes`), `staff_sss_remittances`, `staff_sss_allocation_totals`, `bookkeeper_payments`, and `owner_record_files` (get-only files/chunks). No automatic migration or live business-data write is part of deployment.

Run ordinary Node tests plus `tests/compliance-records-rules-emulator.mjs` against its isolated demo project to verify real Rules authorization and save behavior. The emulator runner refuses a nonlocal endpoint or an occupied test port and does not use cloud credentials.
