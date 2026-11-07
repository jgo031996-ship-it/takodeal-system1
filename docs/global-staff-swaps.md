# Staff schedule swaps across branches

The Staff Portal lists eligible scheduled and standby co-workers from every saved branch for the selected work date. Each option names its branch and shift. Opening the picker does not change the schedule or anyone's home branch.

The requester and recipient see both workplaces. The recipient's acceptance sends the request to HQ; it does not edit shifts. HQ must have access to both affected branches. Approval exchanges the exact dated assignments and saves the original rules and one-day revision through the existing schedule-history transaction. A standby cover removes the selected target standby entry and places the requester on rest in the requester's original branch. Other dates, branches, home branches, attendance and pay records are preserved.

## Selection and freshness

The published dated roster supplies co-worker identities and planned assignments. Cross-branch requests require exact stable staff links; missing or ambiguous links need HQ review. Known inactive or unavailable roster accounts, multiple working assignments and overlapping adjacent shifts are excluded. A standby marker cannot make someone available when they are already working elsewhere.

The Staff Portal refreshes the requester's own profile and saved schedule when opening and sending a request. It does not download the private profiles of all co-workers. HQ rechecks both selected ID-bound profiles and the relevant schedule evidence inside the approval transaction. Changed identities, assignments, permissions, revisions or account status stop the operation. Shift hours must be valid and between one and eighteen hours.

Previous-day evidence is required to check overnight conflicts. Following-day evidence is needed only if an exchanged shift extends beyond midnight; daytime trades at month end remain available when the following month is unpublished. Missing required adjacent evidence requires HQ review.

## Older app windows and requests

New requests use requestVersion 2 and the states “Pending Staff Acceptance” and “Awaiting HQ Review.” Updated Staff and Owner apps also handle existing unversioned “Pending” and “Awaiting HQ Approval” records. Versioned requests cannot be processed through the older review state. This keeps old open windows from accepting a cross-branch trade without its location details or applying it through the single-branch review logic. Staff and HQ should load the updated app files to handle new requests.

The existing Staff/Owner authorization architecture and database rules remain in place. These client workflow checks do not introduce a new server authorization service or broaden access to private HR collections. No Firestore rules or deployed operational functions are changed.

## Verification

Regression coverage exercises the actual Staff picker and submission code, linked cross-branch and standby trades, equal shift IDs in different branches, account and schedule changes during reads, blocked accounts, duplicate assignments, unavailability, overnight and month-boundary conflicts, escaped labels, legacy requests, protocol downgrades, both-branch HQ permissions and atomic approval rollback. Live inspection uses read-only published schedule data; test requests and approvals use fixtures rather than employee records.
