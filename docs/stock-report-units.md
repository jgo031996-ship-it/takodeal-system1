# Stock Report count units

Manual Count records the physical stock in base units. Restock requests also keep their requested base quantity for HQ processing. The report display now shows the physical count separately from the requested restock amount; it does not change those stored quantities or historical records.

Future counts retain a `countSnapshot` with the entered package count, loose count, original base/purchase unit names, conversion, and total base quantity. The same snapshot is recorded with the stock log and automatic request. For example, a count of 1 Pack plus 250 Gram with a saved 1,000 Gram-per-Pack conversion posts 1,250 Gram to inventory, while a separate deficit may request 2 Pack.

Old automatic requests can recover the original conversion only when their retained `qty` (base quantity) and `rawQty` (purchase quantity) form a valid positive ratio with coherent unit labels. The physical count then comes from `physicalStock`; the request amount comes from `qty`/`rawQty`. Current inventory conversions are never used to reinterpret old reports. Records without sufficient saved conversion metadata show their retained base-unit count and a short explanation. A request without a recorded physical count says that the physical count was not recorded.

Verification covers the real submission and report functions with mocked writes, package/loose input, zero counts, no-par counts, concurrent conversion changes, invalid-count rejection before writes, historical ratio recovery, missing-metadata fallback, and escaped item/unit labels. These checks do not write live stock or purchase orders. Existing posting, dispatch, financial, and inventory transaction behavior is outside this display repair.
