# Lead management review and implementation

Updated 20 September 2026. Reviewed the client and server code; no production lead records were modified during implementation or testing.

## Delivered

- **Pipeline board:** nine stages, including existing customers; drag-and-drop and keyboard-accessible Move to menus; per-stage counts and pagination; list view retained.
- **Actionable cards:** owner, contact number, source, temperature, storage requirement, overdue follow-ups, latest non-rejected quote total, expected close date and loss/revisit details.
- **Response tracking:** administrative status changes no longer stamp the first-response clock. Recorded contact attempts, existing outbound WhatsApp handling and successful lead emails count as contact. Existing historical timestamps were not rewritten.
- **Existing-customer closure:** aligned client status definitions and reminder/assignment checks; these records no longer count as open work in the corrected services.
- **Loss details:** manual loss transitions require a structured reason. Optional competitor and revisit date are stored with the transition. Revisit due is an explicit filter; dates do not automatically reopen records.
- **Scheduling:** moves to follow-up or site-visit stages require an owner and a future date/time. The shared dialog works from the board, lead profile, list drawer and follow-up drawer. Dubai time is converted to UTC for storage.
- **Next-action queues:** Missing next action and Revisit due filters apply to the board, list, navigation order and funnel. Missing next action means an open lead without a follow-up or site-visit date.
- **Conflict handling:** status and full-form saves check supplied snapshots and guard the database write against intervening status/timestamp changes. A stale save returns a refresh message before creating or changing tasks.
- **Structured history:** manual moves, attempts, follow-up scheduling, WhatsApp label reconciliation and contract wins record previous stage, next stage, actor where known, and time. New manual lead creation records its initial stage.
- **Reporting:** snapshot counts remain separate from recorded stage entries and win rates. Losses break down by reason, source and owner. Reports use the same page filters and inclusive Dubai lead-date boundaries.
- **Opportunity planning:** expected close date can be edited on the lead profile and full lead form.
- **Quote value forecast:** shows open quoted value, its weighted portion and value without enough history. Uses the latest non-rejected quote per lead, including draft/expired quotes, and excludes closed leads. Stage weights require at least five recorded closed outcomes within the current filter scope; unknown probabilities are not invented.
- **Mobile layout:** corrected the pipeline content width so the board scrolls within the page rather than widening the page.

## Existing strengths retained

Assignment and routing, duplicate phone checks, CSV import, WhatsApp integration, activity timelines, follow-up sequences, lead scoring, quotations and task synchronization remain in place.

## Reporting definitions and limits

1. Historical reporting starts from explicitly recorded stage entries. Old free-text history is not parsed into assumed transitions; skipped stages are not inferred. A lead may have partial history, even when it has at least one structured entry.
2. Stage win rate is recorded wins divided by recorded won/lost outcomes among leads observed entering that stage. Reopened leads and existing customers are excluded from that closed-outcome denominator. This is not a sequential stage-to-stage conversion metric.
3. Median time to win measures creation to the first recorded win. Earlier unrecorded wins are unknown.
4. The date filter selects leads by lead date, not transitions by event date or opportunities by expected close date. Snapshot, history and forecast share that same scope.
5. Quote totals are quoted amounts, not monthly recurring revenue or recognized revenue. Low sample sizes remain uncertain even after the five-outcome minimum. The UI identifies unweighted value separately.
6. Loss details are required for manual API transitions; external label synchronization can still close leads without a human-supplied loss reason. These appear as Not recorded.
7. Historical first-response timestamps have not been backfilled or corrected. Correcting old values requires a separate evidence-based data migration.

## Remaining work that depends on evidence

- Measure production pipeline sizes and request latency before adding a grouped endpoint or virtualized cards. Per-column pagination is in place; no production performance measurements were available.
- Agree any alternative financial basis before switching from quote totals to monthly revenue, excluding expired/draft quotes, or adding period-based forecast targets.
- Consider an audit-backed migration of old transition/response data. Never infer missing history from the current status alone.

## Validation

- TypeScript project check and lint on the new/shared pipeline components.
- Production Vite build passed; the existing large-bundle warning remains.
- Unit tests cover transition validation, response-clock preservation, history counting, reopen behavior, loss grouping, sample thresholds, reminder exclusions and existing lead services.
- Route-level tests use an isolated tenant/model fixture to verify ownership checks, conflict responses, database write guards, required loss/scheduling details and shared report filters.
- Headless browser smoke test covers pointer drag, nine stages, required loss details, Dubai scheduling, failed-save feedback, per-column pagination, shared report filters and desktop/mobile layout. API calls are intercepted; this verifies the client contract without writing real leads.
- Live database persistence, external integrations and delivery of reminders were not exercised against production.

Browser smoke test: `cd client; node scripts/lead-pipeline-smoke.mjs` with Vite running at `http://127.0.0.1:5178`. It uses installed Microsoft Edge in headless mode; override the URL with `LEAD_SMOKE_URL` if needed. Screenshots are written under `client/test-results/lead-pipeline/`.
