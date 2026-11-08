# Inventory variance and Time In declarations

Weekly and other physical-count reports preserve the system balance at submission, actual counted quantities, units and maintaining targets. The saved expected balance already includes posted sales, deliveries, adjustments and waste. Shortage is `max(0, expected − actual)`; excess is `max(0, actual − expected)`. Waste history is shown separately and is never subtracted again. Historical movement reconstruction remains an explanation alongside the frozen balance, with incomplete/offline evidence disclosed rather than invented.

## Counting and requesting stock

Saving a count does not create a stock request. A separate Review saved count stock request action presents the saved maintaining-target deficits; only explicit confirmation sends the request. The idempotent request links `countSubmissionId` to its immutable report. Existing requests retain their statuses, and reopening or retrying a count cannot create another request.

Background forecasting, automatic startup requests and legacy silent count requests are disabled in the updated Cashier. The existing `settings/global_delivery_schedule.requestEnabled` switch is false to stop supported older background timers as well. Owner delivery-date broadcasts merge false while retaining delivery dates and other settings. Devices still need a normal app update for the new count/request UI.

The submitter's short shortage reminder runs after a successful count commit. It uses the exact saved report and bounded, server-confirmed history for its branch and report period through cutoff. A missing-waste reminder requires a negative variance and complete evidence with no matching waste entry. Each source is capped at 300 records; a failed, capped, cached, pending or ambiguous read suppresses the absence reminder without invalidating the saved count. The reminder contains no quantities, item details, values or disciplinary conclusion. The `staff_requests` source is filtered on the server to `type == 'Waste Report'` so unrelated HR requests are not downloaded.

Owner Inventory Audits shows expected, actual, shortage/excess and waste in one table. Dispatch feed and request-review buttons re-read the exact request ID and its report link before opening a native read-only report. A changed request, branch, account or missing older report is explicit. Reviewing variance never changes the dispatch cart or sends stock.

## Time In

Both Staff and Cashier show saved assigned hours and an explicit unrequested-swap choice. Coworkers come from active, unambiguous, stable-ID-linked published roster metadata, with home-branch staff first. Saved work date, branch, shift times, roster alias and canonical staff name remain distinct. The final fresh roster read rejects changed, inactive or stale selections. Actual attendance branch, original schedule snapshot and lateness are retained.

A swap selection is a self-reported `scheduleDeclaration`, not an approved schedule or payroll instruction. Attendance and its linked request are saved atomically with `scheduleDeclarationRequestId`. Staff combines it with its existing late Reason Letter and required proof when applicable; otherwise it uses a Schedule Declaration request. Cashier retains its existing late-proof policy. Assigned-hour and cancellation paths create no extra declaration. Time Out is unchanged.

The Owner's dedicated Review declaration flow may mark the explanation Reviewed. That acknowledgment writes only the request and does not approve a swap or change attendance, schedule, lateness or payroll. Any dated-hours decision uses the existing attendance review. Combined late letters bind the displayed declaration and original punch in the review fingerprint. Fresh generic reply guards keep Schedule Declarations out of ordinary approvals, uploads and deductions.

## Required query indexes

Two collection-scoped indexes were added to Firebase `takodeal-pos` and verified ready using bounded read-only queries; all pre-existing indexes were retained:

```json
[
  {"collectionGroup":"staff_requests","queryScope":"COLLECTION","fields":[{"fieldPath":"branch","order":"ASCENDING"},{"fieldPath":"type","order":"ASCENDING"},{"fieldPath":"timestamp","order":"ASCENDING"},{"fieldPath":"__name__","order":"ASCENDING"}]},
  {"collectionGroup":"staff_requests","queryScope":"COLLECTION","fields":[{"fieldPath":"branch","order":"ASCENDING"},{"fieldPath":"type","order":"ASCENDING"},{"fieldPath":"timestamp","order":"DESCENDING"},{"fieldPath":"__name__","order":"DESCENDING"}]}
]
```

No Firebase rules, grants, staff accounts or operational records were changed during verification. The new declaration metadata is explicitly self-reported; this release does not claim to harden unrelated legacy database permissions. Unit/integration tests and local browser fixtures use synthetic records; live submissions, punches and staff decisions are not used as test data. No AI provider is called by these workflows.
