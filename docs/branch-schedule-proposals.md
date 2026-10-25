# Branch schedule proposals

Any active cashier assigned to the branch can propose assignments from the Cashier app. The proposal is pending until the verified Owner reviews it. This workflow does not edit attendance punches, recorded worked hours or paid payroll.

## Cashier

1. Sign in with your own staff account on the branch tablet. If it needs secure registration, choose **Request secure tablet approval**. The Owner opens **Device Fleet → Cashier device approvals**, matches the physical tablet's branch, Device ID and secure approval UID, then approves it. Back on the tablet, choose **Check approval**. This one-time registration never activates itself.
2. Open **Branch Schedule → Propose schedule changes**.
3. Choose today or future work dates within one month and load the saved roster.
4. Assign staff to the existing HQ shift slots, Standby or Day Off. HQ shift times and approved leave remain protected.
5. Add a reason and confirm with your current staff PIN. The PIN is sent only to the verification service and is not stored with the proposal.
6. Keep the form open if confirmation is uncertain. Retrying in the same form uses the same proposal number.

The current approved roster stays in effect until Owner approval. A date range spanning changes in saved shift rules must be split into separate proposals. Missing or ambiguous staff links require HQ correction first.

## Owner

Open **Human Resources → HR Review Center → Review branch schedule proposals**, or **Schedule Manager → Review branch proposals**. Review the branch, work dates, submitted assignments, original staff account, tablet and submission time. Add a review note and approve or reject.

Approval saves the decision and a dated canonical schedule revision atomically. A changed source roster, staff directory, protected leave or already reviewed proposal requires fresh review. A stable revision number prevents a repeated confirmed approval from adding another revision. Rejection records its note without changing the saved schedule.

Schedule Manager includes an approval-history excerpt with the proposer, tablet, submitted time, Owner reviewer, approval time and linked revision number. HR Review provides **Load more proposals** for additional history. Dates and displayed audit times use Philippine time.

## Verification and scope

The service `branchScheduleProposals` verifies a revocation-checked anonymous Firebase ID token, an active private `pos_bindings` registration and its exact active fleet record, the current active staff profile and branch, and the staff PIN. Submitted names, dates and device details are derived or checked server-side. All schedule sources are read in the same transaction. Codes and full staff profiles never enter proposal records or logs.

Only the service creates or decides proposals. Its separate Owner review endpoint requires a revocation-checked, verified Google Owner token and the exact Owner app origin. It rechecks the complete saved source and current staff inside the same transaction that records approval and its matching canonical dated revision. Firestore client rules permit authorized reads and deny every client proposal write. Private submission and review operation receipts and rate counters are denied to all client identities. Rejection changes no schedule; this service never writes attendance, payroll, stock or receipts. Stable operation and revision numbers make uncertain retries safe.

This feature does not migrate the application's older broad staff-profile and schedule permissions. The new proposal origin, approval and record protections are enforced within this workflow; legacy authorization hardening remains separate work.

The separate runtime account uses only database get/create/update and revoked-token verification permissions. No service-account keys, storage access, Auth write privileges or database query/list privileges are required. Standard Firebase usage charges apply.
