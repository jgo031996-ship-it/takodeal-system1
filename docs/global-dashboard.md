# Global Dashboard

The sales cards, product mix, partner payments, and product report use the selected branch and dates. The trend shows at least seven days ending on the selected end date. Dates use the existing 08:30 business-day cutoff in Philippine time, with a continuous 24-hour window. Voided, unpaid, parked, and locally pending receipts do not count as uploaded sales.

Branch performance and staff on duty share one live table. These rows show current operations rather than the selected historical sales period. Active expected cash is starting cash + paid cash sales (including split payments) − expenses linked to that drawer shift. Closed shifts retain their saved Z-reading figures. Overdue time punches are flagged for review without creating sanctions or changing payroll.

Product optimization loads automatically. Current ingredient costs are matched to the selling branch, with Main Office as a fallback. Missing costs, ambiguous ingredient records, duplicate recipe rows, and missing recipes show a warning and no estimated margin. Receipt discounts are allocated proportionally to product sales. The estimate excludes labor, overhead, and platform fees. Recipe costs are cached for one minute; Refresh reloads them.

Counter increments now recognize explicit Takoyaki pack sizes (including 6, 10, and 15 pieces) and exclude takeaway containers and other products. Sale commits freeze the counted amount and use that same amount for the atomic increment. Voids reverse the frozen original amount once. **Check counter** compares retained paid receipts and the saved historical base without writing over a concurrently updated total. Archived/deleted receipts and unknown pack sizes can make a lifetime reconstruction incomplete. No historical base is guessed.

The separate Live Daily Metrics panel and its listener are removed. Device approvals, Owner review, and Cashier connections have no floating buttons or automatic monitor startup. Their underlying authentication and operation safety remain unchanged.

Dashboard subscriptions stop when navigating away and restart when branch/date scope changes. Late responses cannot overwrite the new scope. Payment chart filters redraw cached data without another sale query. Connection failures and timeouts show a retry message; cached results are labeled.

Validation: run `node --test tests/dashboard-data.test.mjs tests/pos-safety.test.mjs tests/pending-sales.test.mjs tests/recipe-repair.test.mjs tests/payroll-safety.test.mjs`. The separate browser outbox tests use Playwright and cover durable storage and checkout behavior.
