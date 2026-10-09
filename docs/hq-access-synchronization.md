# Protected HQ access synchronization

Every Master Employee profile save writes a protected daily-rate audit. Private
document access also relies on `hq_email_access/{normalizedGoogleEmail}`. Before
this repair, Settings changed only `hq_managers`, leaving the protected record
missing or out of date. Successful Google/PIN login did not establish protected
permissions.

The effective Settings permission editor, HQ registration/profile editor, account
revocation handler and exported legacy monitor grant now use one verified-Owner
adapter. One transaction updates the saved account records and the protected
bridge. Only the main Owner's verified Google identity can run these operations;
the captured UID is checked after awaits and before writes. No account gains
authority by signing in, by its title, or by sharing a PIN.

An Owner can use **Sync saved access** on an existing account. Its confirmation
shows normalized email, active state, exact branches, exact permissions and the
number of saved records. It uses `resolveHQAccount`: the latest explicit
permission save is independent of the latest profile save. Duplicate records
receive the same effective authority and normalized email so sign-in and the
protected projection agree. Profile names, balances and other unrelated data are
preserved. Conflicting PINs hold an active sync until the Owner replaces the PIN;
disabling the whole account remains available even with conflicting PINs.

All tabs never widens an explicitly saved branch scope: an account assigned to
Maa remains scoped to Maa even with `all` permissions. Active accounts require
explicit saved branches. Franchise accounts cannot use `All`. The profile editor
now lets the Owner change registered branch assignments and active status while
preserving existing tab permissions. Role aliases are displayed consistently.
The hardcoded verified main Owner alone retains its existing branch bypass even
if a legacy Owner profile has no assignment. Initial registration explicitly
shows the existing all-tab/All defaults before the Owner confirms a Manager or
Co-Owner grant. Role changes do not add those permissions.
Removing a single-record account disables its protected record in the same
transaction. Duplicate-record deletion is held; disable the account instead.
The adapter also supports email reassignment, disabling the old email's bridge
atomically and rejecting collisions with a different existing account. The
current profile UI keeps the Google email read-only.

Protected fields are `active`, `allowedBranches`, `permissions`, `updatedAt` and
`updatedByUid`. Merged metadata `accessVersion`, `lastSyncOperationId` and
`lastSyncInputHash` protect against stale confirmations and lost acknowledgments.
Operation identity is bound to the reviewed snapshot: retries of that same save
are idempotent, while a fresh review of changed saved access gets a new operation.
No PIN, salary amount, or public profile claims are copied to this record. Existing
unrelated bridge fields remain intact. No new collection or Rules permission is
needed: the published `hq_email_access` policy already requires verified Owner
writes.

Reads use current server state, and the transaction rechecks every known affected
account and bridge before writing. Managed changes serialize through the shared
bridge. The preceding broadly writable legacy HQ profiles are not converted into
a secure staff identity system by this patch; an external legacy writer may add a
new alias outside the Owner-managed transaction. Such a record cannot update the
protected bridge and is never automatically trusted on login. Subsequent Owner
reviews reload the normalized account group. A larger legacy authority migration
remains separate.

Before enabling private documents, review and explicitly sync the existing
approved accounts. Refresh the Owner app to install the new version first. Do not
grant extra permissions to make an error disappear. Existing payroll and private
document records are not changed by this repair.

Focused regressions use real exported transaction and UI functions with an
isolated SDK substitute. They cover canonical duplicates, restricted branch
scope, role changes, disable/revoke/rename, unauthorized or switched identity,
stale previews, transaction races, lost acknowledgments, preserved unrelated
records, and the actual Settings/HQ Profile entrypoints. They perform no cloud
reads or writes.
