# November 2026 Owner schedule audit and guide

Audited `main` at `9cff72c942c51adbf123489068dc37cc86e77798` on October 31, 2026 (Philippine date), including merged PRs #132 and #133. All records used in the new tests are synthetic. No live employee, schedule, attendance, leave or payroll records were read or changed during this audit.

## Confirmed defects and changes

1. **Stale leave projections:** the monthly planner honored saved leave markers even after their original request was rejected, cancelled, moved to different dates, or deleted. The manual assignment guard sent every linked marker to the cancellation workflow, which cannot cancel a rejected or missing request. The planner now reads each exact linked request freshly and proposes releasing inactive markers only in the selected branch's current/future local draft. The review lists the date, employee and source reference. It preserves independent Day Off/suspension flags, other active leave, earlier dates and other branch rows. Missing, conflicting or ambiguous employee identities stay blocked for review.
2. **Unintended whole-draft saves:** assigning staff, changing availability, applying shift rules or editing a swap badge could save the entire monthly draft. These roster operations now mark the local draft dirty. Shift-rule feedback says the change is in the draft. Publishing remains a separate explicit save action through the existing revision and recovery controls.
3. **Branch-pool identity and refresh:** removal previously searched a cached staff list and picked the last matching name. Pulling staff used a name as its selection value, and transfers could leave the scheduling identity directory stale. Pool actions now confirm the current staff ID, update both local directories after a confirmed transfer, and show the actual error. Permanent pool transfers still have their own explicit confirmation; they do not assign or alter roster dates.
4. **Conflicting shifts:** automatic assignment now avoids overlapping overnight shifts present in the loaded month. Preserved duplicate/overlapping assignments are reported for review and are not silently replaced. The planner does not retrieve adjacent months, so cross-month overnight conflicts require separate review.

The Owner service-worker and document release advance together to `takodeal-manager-core-v114-roster-leave-recovery-20261031`, including the new module in offline assets.

## Create and review November

1. After this change is merged and deployed, preserve any open draft and reload the Owner app when its update notice appears. Use **Reload saved schedule** only after saving or preserving edits you want to keep. Installed phone/tablet versions have not been independently verified.
2. Open **Schedule Manager**, select **November 2026** and the correct branch. Set **Changes effective from** to **November 1** for Maa, or **November 5** for Agdao if you want its roster to start on opening day. If you do this later in November, use today or a later date; historical dates remain unchanged.
3. Check the branch's active shifts, exact start/end hours and working weekdays. **Apply Shift Rules to Draft** keeps these changes local.
4. Choose **Create Monthly Schedule**. Select **Prepare empty slots · I will assign staff** or deliberately select **Fill empty slots with available branch staff**.
5. Click **Review monthly schedule**. Check dates, names, unfilled shifts, unavailable staff, proposed stale-marker releases and conflicts. **Cancel** closes this review without changing the editor or saved roster.
6. Click **Use this local draft** only when the proposal is correct. Assign or replace staff by clicking the roster cells. These edits remain local. Recheck all conflicts and coverage.
7. Click **Save Edits** explicitly. Wait for **Saved to HQ**. If saving is not confirmed, preserve/download the local draft and follow the recovery controls; do not repeatedly create or submit replacements.

For a one-day visit to another branch, use the dated relief-staff assignment. **Pull Staff to Branch** and **Remove Staff** in the branch pool are permanent home-branch changes and have their own confirmation.

## If leave still blocks a staff member

- Deleting an Inbox item or rejecting a request does not by itself remove a previously saved roster marker. After this fix, reopen **Create Monthly Schedule**, review **Inactive leave markers to release**, apply the local draft, then use **Save Edits**. The original request is not changed by this review.
- A linked stale marker selected from the roster now opens the monthly-review route instead of trying to cancel a rejected or missing request.
- Active approved leave remains protected. Use its separate **Cancel approved leave dates** workflow only if cancellation is intended; it requires its own explicit confirmation.
- An old historical leave outside the reviewed dates should not block monthly creation. A relevant identity error shows the exact source reference. Use **Open saved leave**, check the employee ID/name and dates, and ask the authorized manager to correct the source identity when needed. Do not guess between same-named staff or delete unrelated history. Reopen the monthly review after correction.
- If records change while a proposal is open, close it and review again. Re-approval, changed dates, transfers, permissions, account changes and edited roster data invalidate the previous proposal.

## Validation

- Synthetic Maa and Agdao cases cover empty months, deliberate autofill, the November 5 opening date, weekdays, inactive shifts, exact and overnight hours, approved/rejected/cancelled/historical/deleted leave, overlapping leave, manual flags, transfers, ambiguous identities, missing/conflicting IDs, duplicate assignments, and conflicts.
- **585 scheduling and leave regression tests passed.** Actual Owner functions and dialog controls are exercised with mocked data. Review/Cancel make no business writes, applying a draft makes no HQ save, and changes to the evidence invalidate reviewed proposals. Existing Save Edits and revision/recovery tests continue to run.
- All three locked Firebase SDK checks passed with network and credential access blocked. Generated security rules match the readable policy. Workspace JavaScript syntax checks and `git diff --check` passed.
- Full regression run: **5,077 passed; 2 failed; 0 skipped**. Both failures also reproduce on unchanged `main`: `loadPayrollGenerator` and `generateAutoPayslips`, in the case “established employment and missing start confirmation never erase completed cutoff hours” (`tests/payroll-preview-integration.test.mjs`). Both expect a `MISSED` preview row. Payroll code and tests were not changed to hide or repair these unrelated baseline failures.
- A reusable synthetic browser fixture is at `tests/fixtures/owner-november-schedule.html`. Visual verification was blocked because the cloud browser could not reach the local HTTP server (`ERR_CONNECTION_REFUSED`). Actual November rosters, live HQ data, installed Owner tablets and the user's home PC remain unverified.
