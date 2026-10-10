# Staff meal checkout index

The Cashier daily meal check queries `staff_requests` with `staffName == verifiedStaffName` and `timestamp >= startOfDay`. It needs a collection-scope composite index:

```json
{
  "collectionGroup": "staff_requests",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "staffName", "order": "ASCENDING" },
    { "fieldPath": "timestamp", "order": "ASCENDING" }
  ]
}
```

The existing descending timestamp index serves other history queries. Keep it. This definition is one required index, not an export of the project's complete index configuration.

The index was added to `takodeal-pos` / `(default)` in Firebase Console on October 10, 2026. Check its Enabled status before relying on the date-range query. Firebase adds the document-name ordering automatically.

`meal-checkout.js` retains that efficient query. Only a missing-index failure retries a fresh, single-field equality query for the exact verified staff name and checks its timestamps locally. Permission/connection errors cannot authorize a meal; undated non-voided staff meal records require HQ review. No rules or access grants are part of this repair.

Reference: [Firebase index management](https://firebase.google.com/docs/firestore/query-data/indexing).
