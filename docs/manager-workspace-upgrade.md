# Manager workspace upgrade · 4 October 2026

The Manager sidebar now has **Edit sidebar tabs** at the bottom. Use the arrows or drag tabs, then select Done. The arrangement is remembered in the current browser. Restore default order is available while editing. HR and Inventory groups move together.

**Menu & Recipes** combines pricing, BOM, recipe costs, margins, images, and display order. Edit item & recipe opens one form with Base, Grab, and Foodpanda prices. Refresh data requests fresh reference data. Menu and BOM reads share a 15-minute cache and concurrent loads share one request; successful edits invalidate the cache, including other open Manager tabs. Inventory costs retain a shorter one-minute cache. This reduces redundant reads, while live sales keep their existing listeners.

Bulk menu CSVs contain actual BOM rows and all platform prices. Use the file exported by this version. RecipeJSON and AddonsJSON hold lists; an empty recipe list intentionally clears that item’s BOM. Imports validate first and write the selected products and recipes in one transaction. Images and display order are retained. Large imports must be split into smaller files.

**Dispatch Stock → Request schedule** configures automatic requests. The default is Friday, 6:00 PM Philippine time. Cashier checks while the app is open, every 15 minutes. Existing pending requests stop another request; a shared branch/day lock prevents duplicate automatic requests across devices. Main Office does not automatically request stock from itself. Delivery creation validates the selected source stock and commits stock, dispatch records, remaining requests, and franchise billing together. Destination stock changes when the cashier receives the delivery. Forecasts never count as physical audits or payroll shortages.

**Mall Branch Mode** starts new drawer shifts with ₱2,000 petty cash. Each closed drawer retains up to ₱2,000 of the actual cash and submits the excess as a pending remittance. A count below ₱2,000 records a float shortage, without creating money. Manager receipt verification credits the HQ Cash account once. Existing historical records and Manager Fund balances are not rewritten. Manager Fund expenses stay outside the drawer calculation. Ordinary branches continue carrying their declared cash between shifts.

**Z-Reading Reports → Archive old Z-Readings** exports and backs up old closed shifts before offering to remove them from the live database. Active shifts, today’s records, and each branch’s latest handover remain. Permanent sale retry markers and lifetime counters remain. No live records were purged for this upgrade.

## Validation

103 calculation, retry, rollback, recipe, payroll, cache, dispatch, CSV, and scheduling checks pass locally. The added tests exercise concurrent clients, lost acknowledgements, partial deliveries, and a scheduler lock that survives request deletion. Both app scripts parse. The Manager UI was checked in a local preview with sample data; no production checkout, remittance receipt, or purge was performed during verification.

## Quick check after updating

1. Refresh Manager and use Force System Update in Cashier, then sign in normally.
2. Move a sidebar tab and reload Manager: its order should persist.
3. Open Menu & Recipes, edit an existing item, and confirm all three prices and its recipe appear together.
4. Open Financial Flow and Dispatch Stock: titles, amounts, and filter choices should be readable.
5. Open Request schedule and review the saved day/time.
6. At the next genuine mall shift, confirm ₱2,000 starting cash. After closing, inspect the pending remittance before verifying actual receipt.

Delivery returns and cashier receipt are saved as transactions. A returned delivery cannot be received, stock returns only once to its original source, and existing negative balances remain visible until an actual stock count corrects them.
