# TAKODEÁL AI Board implementation

Status: implemented in draft PR #155; production release still requires live acceptance checks.

## Verified architecture (2026-11-07)

- Repository: jgo031996-ship-it/takodeal-system1; Owner source: takodeal-manager.
- Vercel: takodeal-owner, project prj_J5GsPdpl2tXLaILQakPa2zqrfNrS, team team_sn9jiCslNUcQOBNirKiMCDjn.
- Production: https://takodeal-owner.vercel.app. Initial production SHA: beea33e3b2adacfe866fba04fc53d5eeef682055.
- Firebase takodeal-pos (248826111383) was verified ACTIVE using the authenticated Firebase CLI.
- The designated owner UID/email were verified against Firebase Authentication; the account was enabled and email verified. UID is pinned in server configuration.
- Field-only live samples confirmed transactions, expenses, inventory, stock_logs, shifts and attendance_logs. No operational records were written.

Owner App -> same-origin /api/ai-board -> signed Firebase token verification -> fresh account/revocation lookup -> projected Firestore reads using the same owner token -> deterministic evidence -> OpenAI Responses -> validated advisory report.

No Firebase admin credentials, service accounts, operational writes, database rules changes, AI tools, background polling or report persistence are introduced. Existing Firestore rules still apply. Static build output excludes server/API source, scripts, package metadata and Markdown; Vercel bundles the API separately.

## Authorization and request boundaries

The server verifies Google's RS256 signature, exact Firebase project issuer/audience, expiry, issued/auth times, verified owner email and configured UID. Every request performs a fresh account lookup to reject disabled, changed or revoked identities before source reads. Broad all-tab, role-label and AI Hub permissions never grant Board access. The actual workspace router and UI also enforce the owner gate.

Questions are limited to 4,000 characters and 31 inclusive Philippine business days, using the dashboard's 08:30 cutoff. Source queries have explicit projections, dates, optional exact branch filters and hard caps with a sentinel document for truncation. Missing index/permission does not trigger an unrestricted fallback.

## Seven director workspaces

| Director | Sources | Analysis |
| --- | --- | --- |
| Finance | transactions, expenses | Recorded sales, valid average receipt, recorded cash outflows |
| Audit | transactions, expenses, shifts | Duplicate branch receipt IDs, payment-verification gaps, invalid amounts, cash differences |
| Inventory | inventory, stock_logs | Current negative/low stock and recorded count differences |
| HR | attendance_logs, shifts | Aggregate attendance/manual-entry and shift process signals |
| Operations | transactions, shifts, attendance_logs | Branch sales, shift evidence and overdue open shifts |
| Marketing | transactions | Recorded payment-channel mix and discounts |
| AI Mentor | All approved sources | Synthesis, decision briefs, challenges, explicitly assumed scenarios and board consultation |

Missing sources are unavailable, never zero. Capped figures are explicitly samples. Customer identities, staff names, photos, signatures, locations and PINs are excluded by Firestore projections. Only calculated summaries and the owner's question are sent to OpenAI; the UI explains this before submission. No raw records are passed to the model.

Output must cite existing evidence IDs. Incomplete/malformed reports and invented citations are rejected. Source/model strings are HTML-escaped. Partial coverage prevents high confidence. Reports clear on navigation; stale responses are canceled/discarded. A warm-instance concurrency/rate guard, input/output limits and service timeouts bound requests. The rate guard is not a distributed global quota.

Server logs contain request ID, director, coverage counts, status and duration; no questions, credentials or raw records. A separate metadata-only usage event records the configured supported model, a bounded response status and available input/output/total token counts, reasoning tokens, cache-read/write counts and 30-minute/12-hour cache-write counts. Only non-negative safe integers from known usage fields are copied. This event is emitted before report validation, including incomplete generations that are rejected; no exact billed-dollar estimate is logged. No reports are saved.

## Explicit limitations

Cash outflows can include purchases/transfers and do not establish profit, margin or bank cash. Stock is a current snapshot, not historical stock; differing units are not summed. Attendance events do not establish unique staff, approved hours, lateness or absence. Count variance does not establish wastage/theft. Channel sales do not establish campaign attribution, ROI, conversion or acquisition cost. This version does not include historical recipe costs, payroll accruals, staff rosters or SOP completion evidence. Directors disclose these gaps and cannot make employment decisions or execute recommendations.

## Server configuration

- AI_BOARD_OWNER_UID: trusted UID verified from takodeal-pos Authentication.
- OPENAI_API_KEY: private key entered directly into Vercel as Sensitive for Preview and Production.
- AI_BOARD_MODEL: optional; default gpt-6.1-terra. The explicit supported set is gpt-6.1-terra and gpt-5.6-terra; both use low reasoning effort, low text verbosity and a 4,500-token output/reasoning limit, with Responses structured outputs and store:false. An unsupported or empty override fails closed with an actionable setup error before source reads or paid generation. The smaller former default did not meet live interpretation-quality checks. Unknowns are constrained to the packet's actual source limitations in the schema and validated again at runtime.

## Cost controls and model acceptance

Each requested consultation makes one OpenAI call, including Board consultation mode; selecting a director does not fan out into seven calls. Reports aim for 350–500 words, at most three specialist findings or six Mentor findings, four exact permitted assumptions/unknowns, two options and three next steps. The array limits are enforced in both the structured schema and runtime validation. Evidence citations, current-stock distinctions and restrictions against unsupported completeness/control claims remain required.

The 4,500-token ceiling includes hidden reasoning and visible output. It leaves headroom for a valid structured report; it is not a reservation charge or a monthly spending cap. A response can consume tokens and still fail as incomplete, so lowering this ceiling without measuring usage can increase manual retries. Source caps, question length, timeouts and the warm-instance rate guard bound individual work but do not establish a distributed account-wide budget. Token metadata supports comparison of actual request usage without claiming an exact bill.

Official model documentation checked on 2026-11-07 lists lower input/output token rates for gpt-6.1-terra than gpt-5.6-terra. This motivates the new default but does not establish equal report quality or a guaranteed percentage saving: input size, actual output/reasoning usage and cache behavior also matter. The final gpt-6.1-terra implementation must pass all seven live director acceptance checks before release; the previously accepted gpt-5.6-terra remains an explicit supported fallback.

Prompt caching is not an application report cache. GPT-5.6 and later models charge for cache writes, and changing source-specific schemas, questions and timestamps can prevent reuse. This change does not introduce explicit cache breakpoints, report persistence or automatic retries. Current primary references: [GPT-6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra), [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [reasoning/output limits](https://developers.openai.com/api/docs/guides/reasoning), and [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

Missing configuration fails closed. Firebase public web configuration matches the existing app. Vercel preview protection remains enabled. Origins are limited to the Owner domain and exact Vercel deployment/branch system URLs.

Branch/date reads require collection-scope composite indexes on branch ascending, timestamp descending, and document name descending. The two missing indexes for expenses and attendance_logs were added through the Firestore Admin indexing API, preserving existing indexes and operational records. Model output schemas restrict citation IDs to each report's actual evidence and require at least one supporting citation per finding.

## Test and release gates

Local tests in tests/ai-board-runtime.test.mjs execute real synthetic RSA verification, owner/revocation boundaries, request limits, projected scoped reads, deterministic totals, all seven director pipelines with controlled upstream fixtures, both supported model configurations, unsupported-model rejection before reads, concise schema/runtime limits, sanitized usage for completed/incomplete responses, blocked methods/origins/writes, unavailable/capped sources, citation validation, escaping and a real local HTTP integration. Existing regression tests and SDK/rules checks also run. The Owner build copies existing app assets while excluding server source.

Controlled tests do not prove live OpenAI/Firebase integration. Before merging or publishing:

1. Run unit, integration, security, regression, syntax and build checks on the final commit.
2. Verify GitHub CI and the protected Vercel preview for that same commit.
3. Sign in as the verified owner on preview; verify anonymous/non-owner denial.
4. Execute every director against real OpenAI and live Firebase evidence. Reconcile exact figures with existing Owner reports using the same branch/date/cutoff. Verify partial and empty-source states.
5. Check desktop/mobile UI, safe navigation, absence of writes and preservation of existing operations.
6. Merge only after acceptance; stage and verify a production build, promote that tested build and verify production alias/runtime results.

Keep PR #155 in draft until these gates complete. Build success alone does not establish a working published Board.
