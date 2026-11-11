# Saved prep recovery

Security Alerts → Private prep reviews now shows an exact-reference recovery check. The verified Google Owner can check whether a saved attempt posted stock, only reported an issue, was closed, or remains unconfirmed. Closing an unposted reference seals it against a late retry and changes no stock. Reviewing a skipped issue adds a private no-stock audit note. Neither action approves or fabricates production.

The Owner must check whether the physical batch was already counted or logged before starting a fresh prep entry. Existing raw-stock, source identity and unit checks remain enforced. Stock values are not reset and old movement history is not rewritten.

Sales consume prepared stock even when it becomes negative. Actual end-of-shift prep later adds its real saved yield once and consumes its raw recipe once. For example, −100 grams cooked stock plus 500 grams actual output leaves 400 grams. No past sale deduction is replayed by recovery.

The read-only Cabantian audit on 2026-11-11 confirmed current bacon receipts include Cooked Bacon deductions. Older production records include unusually large pack counts. The current 738,190-gram cooked balance and negative raw balance need a physical count and confirmed yield before any historical correction. This release does not guess those values.

The Owner entry, cache and update notice use prep-recovery-20261111-r1. Other apps and database rules are outside this frontend release. Tests cover exact-reference requests, owner/lock boundaries, delayed responses, malformed status, no-stock review and closure controls, and exact preservation of prior release hooks. Full validation runs on the exact pushed commit through the hosted prep recovery workflow.
