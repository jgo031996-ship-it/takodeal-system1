# Owner connection and schedule draft recovery

The October 25 report showed Firestore 10.8.1 failing in `TargetState` / `WatchChangeAggregator` before subsequent shift-rule saves. Later errors repeatedly came from its failed asynchronous queue. This is evidence of a failed browser SDK session, not proof of an invalid shift, a rejected rule, lost cloud records or corrupted disk storage.

The Owner app now consistently uses Firebase 13.1.0. Firebase's official release notes document a listener target race fix in 12.13.0 and later listener robustness work. This update also stops redundant network re-enabling on every schedule resume. A version upgrade is not a guarantee against every SDK failure.

On an internal Firestore assertion, one failure guard stops new reads and writes in that page session and displays a fixed connection notice. Original technical diagnostics remain available. The app does not clear IndexedDB, reset registrations or automatically reload.

## Schedule recovery

The schedule editor stores a separate local recovery draft before a cloud save. It includes the captured editor, exact pending payload, original expected revision, effective date and stable operation number. It contains no login PINs or authentication tokens and is bound to the verified account, permission scope and selected month. A local transaction acknowledgement is required before a save or a recovery reload proceeds.

**Reload app and recover** captures the latest visible edits again and reloads only after their local backup is confirmed. After reopening and unlocking the same account, the app compares the backup with a fresh HQ roster. Choose **Restore draft** explicitly; restoration never saves to HQ automatically. A confirmed original operation is recognized by its saved revision. Changed source versions, stale permissions, old dates and expired drafts remain available for manual review/export instead of overwriting a newer roster.

The save wait is bounded while the original physical operation remains deduplicated. An unknown acknowledgement is described as **not confirmed**. It is never treated as a definite failed payment or successful schedule save. Local backup failure keeps the editor open and prevents the recovery reload.

Local drafts are not a backup of every Owner tab. Keep other unsaved forms open and preserve their work before restarting. A window already open on the previous app generation does not gain the new recovery code until it loads the update; do not promise that its earlier unsaved work was backed up.

Sources: [Firebase JavaScript release notes](https://firebase.google.com/support/release-notes/js), [Firebase listener target race fix](https://github.com/firebase/firebase-js-sdk/pull/9842).
