# TAKODEÁL AI Board — Foundation Plan

**Status:** Phase 1 foundation specification  
**Target application:** Existing `takodeal-manager` Owner App / HQ  
**Access:** Owner only  
**Authority:** Recommendation-only; no business actions  
**Data:** Existing TAKODEÁL Firestore and application readers  
**Deployment:** Not authorized in this phase

## Product goal

Give the TAKODEÁL owner a private AI Board that turns verified operating data into clear explanations, risks, options, and recommendations. The AI Board is an advisory workspace, not an autonomous operator.

## Board membership

1. **Finance Director** — revenue, expenses, margins, cash flow, branch comparisons, and investment scenarios.
2. **Audit Director** — data consistency, duplicate or unusual records, reconciliation gaps, and control exceptions.
3. **Inventory Director** — stock movement, usage, wastage, purchasing signals, and inventory variance.
4. **HR Director** — staffing coverage, attendance and schedule insights, training needs, and people-process risks.
5. **Operations Director** — branch performance, SOP adherence, service consistency, and operational bottlenecks.
6. **Marketing Director** — promotion performance, customer demand, channel mix, and campaign recommendations.
7. **AI Mentor & Strategic Advisor** — the owner's decision partner. It frames decisions, identifies missing evidence, compares options, challenges assumptions, presents the strongest counterargument, explains trade-offs, and recommends proceed / reconsider / wait with a practical plan.

The AI Mentor may synthesize reports from the six specialist directors. It must clearly distinguish measured facts, estimates, assumptions, and unknowns. It must not simply agree with the owner.

## Owner decision workspace

The Mentor should support:
- **Ask the Mentor:** open-ended business questions grounded in available company data.
- **Decision Brief:** decision, objective, options, constraints, evidence, risks, recommendation, confidence, and next steps.
- **Challenge My Decision:** stress-test the owner's proposed decision; include a credible argument against it.
- **Scenario Comparison:** compare explicitly stated assumptions without presenting projections as actual results.
- **Board Consultation:** request relevant specialist perspectives, then provide a consolidated answer.

Ask only for essential missing information. Never invent sales, costs, staff events, branch results, or historical facts. If the data is incomplete or stale, say so and reduce confidence.

## Security and authority requirements

- Only the verified TAKODEÁL owner account may open or call AI Board features.
- Do not inherit AI Hub / bulletin publishing permissions. Existing bulletin access is broader than the owner-only requirement and is not an authorization boundary for this product.
- Enforce owner authorization on every server endpoint using the authenticated Firebase identity and a trusted owner allowlist or server-verified claim. A hidden navigation item is not security.
- Enforce matching Firestore rules for all AI Board collections.
- Source business data is read-only. The AI service may write only to its dedicated AI Board collections.
- No tools or code paths for publishing announcements, changing sales, inventory, purchases, expenses, payroll, schedules, employee sanctions, permissions, or other business records.
- Keep the OpenAI API key server-side only. Never ship it in browser JavaScript or client configuration.
- Record owner requests, report generation metadata, data coverage, and failures in an audit trail without unnecessarily storing sensitive prompts or personal data.
- Fail closed on missing identity, insufficient permission, unavailable data, or uncertain writes.

## Proposed architecture

1. **Owner App UI:** a dedicated AI Board route within the existing HQ shell, with a board overview and seven director workspaces.
2. **Authentication:** reuse Firebase Authentication for identity, but create a separate strict owner-only authorization check for AI Board endpoints.
3. **Server boundary:** Vercel server-side endpoints authenticate the Firebase ID token, authorize the owner, load bounded read-only data, calculate deterministic metrics, and call the OpenAI API.
4. **Verified calculations:** financial totals, inventory variance, reconciliation checks, and other arithmetic are calculated in deterministic application code. The model explains those results; it does not invent or independently calculate source-of-truth totals.
5. **AI layer:** structured inputs and outputs, explicit evidence references, confidence and coverage fields, and clear separation between facts and recommendations.
6. **Persistence:** isolated collections proposed below. No writes to operational collections.
7. **Scheduling:** only after manual analysis is validated; any scheduled analysis must remain advisory and owner-visible.

## Proposed AI-only Firestore collections

- `ai_board_reports` — completed board/director reports and decision briefs.
- `ai_board_insights` — owner-visible recommendations and follow-up status.
- `ai_board_runs` — run metadata, source coverage, model/version metadata, and failures.
- `ai_board_settings` — owner-controlled preferences and enabled director configuration.
- `ai_board_feedback` — owner feedback on usefulness and accuracy.

These are proposed names, not a claim that the collections already exist. Security rules must deny all non-owner access and deny client writes except where a narrowly scoped owner workflow explicitly requires them. Prefer server-mediated writes.

## Existing code observations to carry into implementation

- `ai-hub.js` and `ai-hub-model.js` currently implement deterministic announcement drafting and publishing, not an OpenAI-powered board. Do not repurpose their bulletin publishing flow as the AI Board.
- `ai-hub-model.js` exposes `canPublish` that can grant access through broad permissions such as `all` or `bulletin`; that is not sufficient for owner-only AI Board access.
- `workspace-access-model.js` contains an owner email constant and broad workspace permission helpers. Do not assume a client-side email check alone secures a server endpoint.
- `inventory-intelligence-reader.js` contains bounded read-only inventory reads and branch-access logic. Validate its identity/authorization behavior before reuse in a strictly owner-only server context.
- `financial-flow-model.js` is a candidate for deterministic financial calculations, subject to source and test review.

## Delivery phases and acceptance gates

### Phase 1 — Repository, data, and security audit
- Map the actual Owner App entry points, Vercel project/root configuration, Firebase setup, Firestore rules, and server deployment conventions.
- Map the actual collections and fields for branches, sales, expenses, inventory, stock deductions, staff, schedules, payroll, and marketing evidence.
- Identify and test reusable read-only readers and deterministic calculation modules.
- Document data freshness, completeness, branch identifiers, and known gaps.
- **Gate:** no AI endpoint or UI activation until owner-only enforcement and source mapping are verified.

### Phase 2 — AI Board foundation
- Add owner-only navigation and the seven director workspaces in the existing Owner App.
- Add isolated AI Board server routes and collections with deny-by-default access.
- Add structured report contracts, run logging, and a disabled-by-default feature flag.
- **Gate:** non-owner access tests pass; source business collections remain unchanged.

### Phase 3 — Finance and Audit pilots
- Start with read-only historical reports and deterministic totals.
- Reconcile report outputs against known records and existing dashboards.
- Display coverage, date range, branch scope, and limitations on every report.
- **Gate:** owner validates results against actual records before broader use.

### Phase 4 — Inventory
- Add stock movement, wastage, usage, and purchasing insights using verified readers.
- Avoid any automatic stock adjustments or purchase actions.

### Phase 5 — HR and Operations
- Add workforce and branch-process analysis with careful access controls and data minimization.
- Do not make employment decisions or issue sanctions.

### Phase 6 — Marketing and executive synthesis
- Add campaign and channel analysis where reliable source data exists.
- Enable AI Mentor board consultations and decision briefs using validated specialist reports.

## Non-goals and explicit safeguards

This project does not rebuild the POS, Manager, Staff, Customer, or Franchisee apps. It does not automate business decisions. It does not execute recommendations. It does not alter operational records, permissions, or deployment settings as part of progress reviews.

## Current starting point

The initial source inspection found an existing Owner/Manager application and candidate finance/inventory modules, but the complete Firestore map, Firestore security rules, actual Vercel project configuration, and server deployment location still require verification. No AI Board implementation or verified OpenAI integration was present in the reviewed files at the time of this plan.

**Next engineering task:** complete Phase 1 mapping and tests before creating production AI routes or connecting the model.
