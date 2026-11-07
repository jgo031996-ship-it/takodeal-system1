# Simple Franchise AI Board

The Franchisee workspace includes an **AI Board** page with Finance, Audit, Inventory, HR, Operations, Marketing and Mentor cards. A selected-branch snapshot is calculated from available uploaded records without an OpenAI call. **Generate briefing** makes one optional short request for all seven perspectives; it does not run automatically, change records or send messages.

## Access and data

The page calls the separate Owner-hosted `/api/franchise-ai-board` endpoint. The existing Owner Board endpoint and its strict Owner authorization remain unchanged. The central endpoint uses the existing Owner project's server-only provider configuration; no key is copied into the Franchise project or browser.

Every request verifies the Firebase Google ID token signature, project, issuer, expiry, verified email, current account and revocation state. Franchise access requires active saved Franchise-role metadata, its explicit assigned branches, an active protected HQ grant and intersected saved/protected permissions. `All`, unassigned branches, inconsistent accounts and unavailable authority evidence fail closed. The pinned verified system Owner can inspect an explicit active branch for administration. Other HQ roles do not inherit this Board from an all-tabs permission.

Branch metadata is checked against an exact active canonical record. Each source uses an exact branch filter, server-side field projection, date bounds and a bounded result count. Source permissions remain separate; the Board permission does not grant access to inventory, payroll or other pages. The response and model input contain aggregate metrics and coverage, never staff identities/wages/PINs, customer references, signatures or private documents. No operational write API is exposed. Existing global Firebase rules and deployed operational functions are unchanged; this feature does not claim to harden unrelated legacy rules.

Scopes use inclusive Philippine business days, from 08:30 to 08:30 the following day, up to 31 days. Inventory is a current snapshot and is labelled separately from historical event records. Missing or capped sources remain explicit; unavailable data is not converted to zero. Cash outflows and sales are not presented as profit or available cash. Attendance counts do not determine individual employment outcomes.

## Cost controls and response checks

The optional briefing uses `gpt-6-luna`, reasoning `none`, low verbosity, strict structured output and at most 2,200 output tokens. `FRANCHISE_AI_BOARD_MODEL` is a separate optional override; the existing Owner model setting is not inherited or changed. Source evidence IDs and output size/schema are validated before display. Missing perspectives retain the calculated unavailable-source explanation.

Snapshots may be reused for 60 seconds (10 seconds for partial coverage), and identical meaningful briefings for ten minutes. Cache keys bind identity, effective permissions, branch and dates; account/grant checks run before hits and again after source/model work before returning or caching. The UI distinguishes data time from briefing generation time. Warm-instance request and generation limits plus physical in-flight locks reduce duplicate costs; they are not a global spending cap.

Only canonical Franchise and Owner origins are accepted for cross-origin browser requests. Private API responses and authentication/business reads are not placed in the public app cache. Franchise cache v15 includes the new UI assets; Owner static files and its cache release remain unchanged.

## Verification

The executed regression suite covers signed JWT failures, disabled/revoked accounts, role/grant/branch conflicts, source permissions, cross-branch responses, partial sources, source record identities, output grounding/citations, unsupported model overrides, concurrent generation, access changes during generation, cache scope, escaped rendering and UI lifecycle changes. Local browser fixtures use actual UI modules and packet builders with synthetic records. Real provider/live account checks must be reported separately from these mocked integration tests; opening a page or finding a configured key is not proof of successful AI generation.

Existing Franchise accounts without active protected HQ access remain denied. Provisioning or changing those grants is a separate Owner access decision; this release does not activate accounts.
