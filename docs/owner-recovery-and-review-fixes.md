# Owner dispatch recovery and review fixes

## Saved dispatch quantities

The saved quantity reference offers **Load back to dispatch cart**. Loading is a local draft operation, separate from **Send delivery**. It requires an empty cart, current branch access, unchanged units and inventory identity, and confirmed request links. If old links are closed, the Owner selects a compatible open request with the same route and complete item list, then reviews the replacement links and exact entered quantities. Closed requests are not reopened.

Full references include zero-quantity rows. The existing Send transaction retains its stock, restock, remaining-item and batch-size checks. Unresolved or already committed save attempts stop recovery. A restored reference becomes view-only, preventing the same saved quantities from being loaded again after dispatch. Changed or unavailable source evidence leaves the reference intact.

## Pending digital payments and Sales History

The normal version-2 POS writer records a canonical sale ID, inventory posting state and statistics marker but does not always write a status label. The pending reader recognizes these receipts only with that posting metadata. Explicit unknown, pending, cancelled/refunded, split and otherwise ineligible rows remain excluded. Before a selected missing-status payment can be manually verified, the existing atomic review transaction checks the matching POS commit marker and exact saved receipt fingerprint. This does not backfill statuses, verify payments automatically or change statement-import eligibility.

Opening Pending Verifications scans the selected permitted branch/date scope automatically through bounded pages, up to 2,000 receipts. Progress, errors and incomplete limits are explicit. A scope change clears old results; a refresh retries the complete scope. The recent alert badge retains its separate rolling date range and broader alert meaning.

Entering Sales History starts its report. Figures show loading placeholders and become unavailable when required inputs fail, rather than presenting an unfinished report as zero sales. Repeated reads are coalesced, bounded by a visible deadline, and prevented from rendering into a replaced account, view or reporting scope.

## Reason letters and contract copies

A proposed-shift Reason Letter links to the existing Owner worked-shift correction flow for the exact employee, attendance and work date. Returning after applying or cancelling reloads the letter from saved evidence and retains the typed reply. A trusted correction must match the proposal's original saved slot and hours before the separate explicit approval can proceed; both preview and transaction enforce this. Original lateness is preserved until that separate decision. A shift still in progress requires an actual recorded Time Out before it can be reviewed as worked. Existing conflict, paid-payroll and dated-review blockers remain in force.

Saved contract buttons now invoke an installed Owner printer with the exact employee ID. It refreshes the saved acceptance date, term and applicable wage and rechecks profile/account/branch access. Initial, Extension and Regularization remain distinct. Invalid or unsigned records require HR review. Printing does not sign, accept or modify a contract.

## Verification scope

Tests exercise actual loaders, review handlers and transactions with synthetic records, including retries, account/scope races, changed sources and atomic rollback. Browser screens use isolated sample data for dispatch recovery and pending payment loading. Production checks are read-only; publishing this software does not dispatch stock, verify sales or approve employee requests.
