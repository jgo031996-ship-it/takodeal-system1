# Cashier saved prep recovery

The Shift Sales recovery controls are inside the existing sales card, above the table. Their receipt correction callbacks are unchanged.

Kitchen Prep displays the entered pack/batch count, saved output yield in base units, ingredient deductions and resulting balances before confirmation. More than 50 packs/batches requires a second quantity confirmation. Cooked Bacon's confirmed saved yield remains 500 grams per Pack (1Kg); the label describes the prep costing input and is not silently treated as 1,000 grams cooked output.

An older prep attempt can be checked using a current verified session for the same employee, Firebase identity, device and branch. A new session is used only to check its status, never to commit that older attempt. A confirmed saved, skipped or Owner-closed result finishes only the matching local reference. Pending, unknown or conflicting responses retain the reference and show the Owner recovery path. Staff PINs are not stored.

Ordinary checkout, signed-in shifts, queued receipts, attendance, sale deductions and authorization remain on their exact prior implementations. A deficit in prepared stock is retained: sales may reduce it before actual prep is logged, and the later real batch adds its saved yield once. Recovery never invents production or credits raw stock. Invalid raw records still require a physical stock/source review; issue reporting does not post stock.

The Cashier release identifier is cashier-prep-recovery-20261111-r1. The hosted branch workflow checks the exact commit, all six app scripts, locked SDKs, generated rules and the normal suite. New tests include the actual frozen backend recovery responses, original-session boundaries, lost acknowledgments, closed/unknown status and quantity confirmations. Production business records are not used for mutation tests.
