# Payroll record recovery and roster review

Owner payroll previews now compare schedule evidence for the selected cutoff, including adjacent shift dates, rather than the current head of every loaded month. Relevant dated rules, roster snapshots, holidays, amendments, policy and legacy fallback inputs still invalidate an unpaid preview. Paid snapshots remain frozen. Pre-update previews must be generated once with the new cutoff-specific check.

Checking a saved payment is read-only. A completed search with no record is informational and is not proof that the employee was never paid outside the app. Confirm the original amount, date and account before recording an outside payment. Incomplete or failed reads remain unconfirmed. Payment settlement, duplicate-payment checks, source deductions and account transactions are unchanged.

Revoked, inactive or missing employees cannot enter the payable list solely because of a historical balance. Their records appear under **Former staff & unmatched balances** with original amount, date and reference. Current staff with balances remain in payroll. Former staff with selected-cutoff earnings, missed-punch review or earned adjustments remain available for final-pay review. Existing paid history remains visible unchanged.

Employee matching uses stable IDs and unique saved names/aliases. It does not guess spelling corrections or transfer a balance between similar names. Ambiguous source attendance holds an unpaid preview. Saved paid IDs also protect against a second payable preview under a new name. No records are deleted, collected, forgiven or reassigned by generating this list or opening the review panel.

The release changes Owner application code only. It performs no migration, payment, bank adjustment, staff revocation or database Rules change. Regression tests use synthetic staff, payroll and account records.
