# EngageIQ — Development Roadmap

> **Built by Swift Studioz, Lahore, Pakistan**
> Version: 1.0 | Created: 2026-04-27

---

## How to Use This Roadmap

- Each **Phase** is a self-contained block of work.
- Each **Milestone** within a phase is completed in its own dedicated session.
- Every session starts by reading `memory/context.md` for full project context.
- Every session ends by following the **Session Closing Protocol** below.

---

## Session Closing Protocol

After **every** completed milestone, new feature, or bug fix, you MUST:

1. **Write an update file** in the `updates/` directory:
   - Filename format: `YYYY-MM-DD_<phase>_<milestone-slug>.md`
   - Example: `2026-05-01_phase1_project-scaffold.md`
   - Contents: what was built, decisions made, any deviations from the plan, known issues left open.

2. **Update `memory/context.md`**:
   - Change "Current phase" to the phase just completed or in progress.
   - Add the completed milestone to the "Completed Milestones" list with the date.
   - Update "Known Issues / Blockers" if anything was found.
   - Record any architectural decisions made under "Key Decisions Made."

3. **Commit all work** with a clear commit message referencing the milestone.

Skipping this protocol means the next session starts blind. Do not skip it.

---

## Phase Overview

| Phase | Name | Milestones | Depends On |
|---|---|---|---|
| 1 | Foundation & Infrastructure | 4 | — |
| 2 | Shopify Integration & Data Ingestion | 4 | Phase 1 |
| 3 | Unified Customer Profiles | 3 | Phase 2 |
| 4 | Analytics Engine | 5 | Phase 3 |
| 5 | Segmentation Engine | 3 | Phase 3 |
| 6 | Campaign & Automation Engine | 5 | Phase 4, 5 |
| 7 | AI & Intelligence Layer | 4 | Phase 3, 6 |
| 8 | Platform & Integrations | 3 | Phase 6 |
| 9 | South Asia Specialization | 3 | Phase 6, 7 |
| 10 | QA, Hardening & Launch | 4 | All phases |

---

## Phase 1 — Foundation & Infrastructure

**Goal:** Scaffold the entire project, configure databases, set up multi-tenant architecture, auth, and job queue. No business logic yet — just the skeleton everything else plugs into.

### Milestone 1.1 — Project Scaffold & Monorepo Setup

- Initialize monorepo (e.g. Turborepo or pnpm workspaces)
- Packages: `apps/api` (Fastify), `apps/web` (Remix), `packages/db`, `packages/queue`, `packages/shared`
- TypeScript configuration across all packages
- ESLint + Prettier config
- Environment variable management (dotenv + validation with zod)
- Docker Compose for local dev: PostgreSQL, ClickHouse, Redis

**Update file:** `updates/YYYY-MM-DD_phase1_project-scaffold.md`

---

### Milestone 1.2 — Database Schema (PostgreSQL)

Set up Prisma (or Drizzle) ORM and create all core PostgreSQL tables:

- `merchants`
- `customers`
- `segments` + `segment_memberships`
- `campaigns`
- `journeys` + `journey_steps` + `journey_enrollments`
- `cod_orders`
- `api_keys`
- `users` (dashboard users) + `roles`

Run migrations. Seed with a test merchant and test customers.

**Update file:** `updates/YYYY-MM-DD_phase1_postgres-schema.md`

---

### Milestone 1.3 — ClickHouse Event Store Setup

- Provision ClickHouse (Docker locally, managed in prod)
- Create `events` table with correct schema, partitioning by `toYYYYMM(timestamp)`, primary key `(merchant_id, customer_id, timestamp)`
- Write a simple event ingestion function and verify a round-trip write + query
- Create an abstraction layer (`packages/db/clickhouse.ts`) so the rest of the app never imports ClickHouse directly

**Update file:** `updates/YYYY-MM-DD_phase1_clickhouse-setup.md`

---

### Milestone 1.4 — Auth, RBAC & Multi-Tenancy

- JWT-based auth for dashboard users
- Role system: Owner, Admin, Marketer, Analyst, Agency Admin, Agency Member
- Every API route enforces `merchant_id` scoping — no route returns data without a resolved tenant
- API key auth for the Custom Event API (separate from dashboard JWT)
- Agency parent/child account structure in the DB and middleware

**Update file:** `updates/YYYY-MM-DD_phase1_auth-rbac.md`

---

## Phase 2 — Shopify Integration & Data Ingestion

**Goal:** Connect a Shopify store. Pull data in. Process it reliably. This is the primary data source for everything downstream.

### Milestone 2.1 — Shopify App Setup & OAuth

- Create a Shopify App in the Partner Dashboard
- Implement the OAuth install flow (redirect → authorize → exchange token → store credentials)
- Register all required webhook topics on install:
  `orders/create`, `orders/updated`, `orders/paid`, `customers/create`, `customers/update`, `checkouts/create`, `checkouts/update`, `products/update`, `inventory_levels/update`, `refunds/create`
- Webhook HMAC signature validation on every incoming request
- App Embed Block injection point for the storefront SDK (stubbed for now)

**Update file:** `updates/YYYY-MM-DD_phase2_shopify-app-oauth.md`

---

### Milestone 2.2 — Webhook Processing Pipeline

- BullMQ queue for incoming webhooks (`webhook-ingestion` queue)
- Worker that dequeues, deduplicates (idempotency key = Shopify webhook ID), transforms, and writes to PostgreSQL
- Handle each webhook type:
  - `orders/*` → upsert order + update customer aggregates
  - `customers/*` → upsert customer profile
  - `checkouts/*` → create/update abandoned checkout record
  - `products/update` + `inventory_levels/update` → product catalog cache
  - `refunds/create` → update order + customer return rate
- COD detection: flag orders where `payment_gateway` is COD or `payment_status` is `pending`

**Update file:** `updates/YYYY-MM-DD_phase2_webhook-pipeline.md`

---

### Milestone 2.3 — Historical Backfill

- On first app install, enqueue a backfill job
- Use Shopify Admin REST API (paginated) to pull full history:
  - All customers
  - All orders (last 2 years minimum)
- Write to PostgreSQL and compute initial customer aggregates (total_orders, total_spent, avg_order_value, first/last order dates)
- Show backfill progress in the dashboard (% complete)
- Handle rate limiting (Shopify: 2 req/sec on REST, leaky bucket)

**Update file:** `updates/YYYY-MM-DD_phase2_historical-backfill.md`

---

### Milestone 2.4 — Storefront Event Tracking SDK

- Build the JavaScript SDK (`<5KB gzipped`)
- Events to capture: `page_view`, `product_view`, `collection_view`, `search_query`, `add_to_cart`, `remove_from_cart`, `cart_view`, `checkout_started`, `checkout_step`, `product_image_zoom`, `scroll_depth`, `time_on_page`, `exit_intent`
- Anonymous visitor tracking with `anon_id` in a first-party cookie
- Identity stitching: when customer logs in or completes checkout, link `anon_id` → `customer_id` and backfill events
- Events POST to `/api/v1/sdk/events` (unauthenticated, rate-limited by IP)
- SDK injected via Shopify App Embed Block (no theme editing required)

**Update file:** `updates/YYYY-MM-DD_phase2_storefront-sdk.md`

---

## Phase 3 — Unified Customer Profiles

**Goal:** Build the core data object. Every downstream feature reads from and writes to unified customer profiles.

### Milestone 3.1 — Profile Aggregation & Real-Time Updates

- Customer profile object matches the full schema from the feature guide (Identity, Shopify Data, Behavioral Data, RFM Scores, AI Scores, COD Profile, Campaign Engagement, Segment Memberships)
- Profile computed fields (total_orders, total_spent, avg_order_value, last_seen_at, session_count, etc.) kept in sync as events arrive
- Profile API: `GET /api/v1/customers/:id` returns the full enriched profile
- Dashboard customer detail page: renders every field

**Update file:** `updates/YYYY-MM-DD_phase3_profile-aggregation.md`

---

### Milestone 3.2 — Identity Resolution

- Email match: anonymous session → known profile on email capture
- Phone match: normalized to E.164, matched on checkout / API events
- Shopify `customer_id` match: on login event from SDK
- Explicit merge: dashboard UI to manually merge two profiles
- Conflict resolution: older profile ID becomes canonical; all events/orders migrated from secondary; secondary marked `merged_into`

**Update file:** `updates/YYYY-MM-DD_phase3_identity-resolution.md`

---

### Milestone 3.3 — Custom Event API & Multi-Store Unification

**Custom Event API:**
- `POST /api/v1/events` authenticated by merchant API key
- Accept any JSON properties; properties become queryable in segment builder
- Rate limit: 1,000 events/sec on Growth plan

**Multi-Store Unification:**
- Merchant can connect multiple Shopify stores to one EngageIQ account
- On ingestion, match customers across stores by email + phone
- Assign `group_customer_id` for matched cross-store customers
- Group-level analytics views (total revenue, overlap %, top customers by group spend)

**Update file:** `updates/YYYY-MM-DD_phase3_custom-events-multistore.md`

---

## Phase 4 — Analytics Engine

**Goal:** Turn raw data into insight. Build every analytics view in the feature guide.

### Milestone 4.1 — Real-Time Dashboard

- Live active visitors (ClickHouse query, polled every 30s)
- Revenue today vs. yesterday vs. same day last week
- Orders today (total, COD vs. prepaid breakdown)
- New vs. returning customers today
- Active campaigns and their real-time stats
- Alerts widget (churn spike, campaign anomaly)
- Color-coded KPI cards (green/amber/red vs. target)

**Update file:** `updates/YYYY-MM-DD_phase4_realtime-dashboard.md`

---

### Milestone 4.2 — RFM Scoring Engine

- Daily batch job (BullMQ scheduled) that recalculates R, F, M scores for all customers
- Scores are relative (percentile-based within merchant's own customer base)
- Assigns named segment: Champion, Loyal, Potential Loyalist, New Customer, Promising, Need Attention, About to Sleep, At Risk, Cannot Lose Them, Hibernating, Lost
- Score changes trigger segment re-assignment
- RFM segment view in dashboard with segment sizes and trend over time

**Update file:** `updates/YYYY-MM-DD_phase4_rfm-engine.md`

---

### Milestone 4.3 — Funnel Analysis

- Funnel builder UI: add steps from event name list, apply filters (date range, category, segment)
- ClickHouse query: sequential funnel computation (customers who did step N also did step N+1)
- Output: customer count and drop-off % at each step
- Funnel comparison: same funnel across two periods, two categories, or two segments

**Update file:** `updates/YYYY-MM-DD_phase4_funnel-analysis.md`

---

### Milestone 4.4 — Cohort Retention Analysis

- Cohort grouping: by first purchase month (default), product category, acquisition channel, RFM segment
- Retention matrix: cohort × period (months 1–12)
- ClickHouse query for retention calculation
- Visual cohort table in dashboard with heat-map coloring

**Update file:** `updates/YYYY-MM-DD_phase4_cohort-retention.md`

---

### Milestone 4.5 — Revenue Attribution, Product Retention & COD Analytics

**Revenue Attribution:**
- UTM-style tracking parameter on every campaign send
- Attribution window: 7d email, 24h SMS/push, 3d WhatsApp
- Models: last touch, first touch, linear, time decay
- Dashboard: revenue by channel, by campaign, by automation flow, ROI per campaign

**Product-Level Retention Analytics:**
- Per-product: repurchase rate (90d), cross-sell rate, LTV of buyers, return rate, time to second purchase
- Ranked list of products by "retention value"

**COD Analytics Dashboard:**
- COD acceptance rate, rejection rate (by city / courier / category / order value)
- Fake order rate, COD-to-prepaid conversion rate, avg days to collect
- Net revenue COD vs. prepaid
- City-level heatmap of Pakistan (acceptance rate choropleth)

**Update file:** `updates/YYYY-MM-DD_phase4_attribution-product-cod-analytics.md`

---

## Phase 5 — Segmentation Engine

**Goal:** Let merchants slice their customer base into precise, dynamic audiences.

### Milestone 5.1 — Behavioral Segment Builder

- Visual condition builder UI: event conditions ("has done / has not done"), property conditions (attribute + operator + value)
- Combine with AND / OR / NOT / nested groups
- Supported attributes: all customer profile fields, all event types, RFM segment, churn score, LTV prediction, COD profile fields, custom event properties
- Save segment → compute initial membership → display count

**Update file:** `updates/YYYY-MM-DD_phase5_segment-builder.md`

---

### Milestone 5.2 — Dynamic Segment Evaluation

- On every event ingestion, identify which segment definitions are affected by that event type
- Re-evaluate only the relevant customer against those segments (not full recompute)
- Update `segment_memberships` (enter / exit) in real time
- Live member count counter in dashboard

**Update file:** `updates/YYYY-MM-DD_phase5_dynamic-segments.md`

---

### Milestone 5.3 — AI Segment Discovery

- Python microservice: run k-means / DBSCAN clustering on customer feature vectors (RFM, LTV, behavioral aggregates)
- Surface top N discovered clusters with: estimated size, avg LTV, behavioral description, recommended action
- One-click: convert discovered cluster to an official named segment
- Re-run weekly (scheduled job)

**Update file:** `updates/YYYY-MM-DD_phase5_ai-segment-discovery.md`

---

## Phase 6 — Campaign & Automation Engine

**Goal:** Let merchants send messages and build automated journeys across all channels.

### Milestone 6.1 — Visual Journey Builder

- Drag-and-drop canvas (React Flow or similar)
- Node types: Trigger, Action, Condition/Branch, Time Delay, A/B Split
- All trigger types from the feature guide
- All action types from the feature guide
- Branch conditions from the feature guide
- Journey saved as a JSON graph; stored in `journey_steps`
- Journey activation / pause / archive controls

**Update file:** `updates/YYYY-MM-DD_phase6_journey-builder.md`

---

### Milestone 6.2 — Journey Execution Engine

- `journey-executor` BullMQ worker
- On trigger fire: enroll customer → `journey_enrollments`
- Step execution: evaluate conditions, pick branch, execute action (send message / update tag / add to segment / fire webhook)
- Time delay: schedule next step via BullMQ delayed job
- Handle re-entry rules (allow / disallow / re-enroll after exit)
- Dead-letter queue for failed step executions
- Journey analytics: enrollments, completions, drop-off by step

**Update file:** `updates/YYYY-MM-DD_phase6_journey-execution.md`

---

### Milestone 6.3 — WhatsApp & SMS Channel Adapters

**WhatsApp (Meta Cloud API):**
- Template management UI: create, submit for Meta approval, track approval status
- Template categories: Utility, Marketing
- Two-way conversation handler: inbound message webhook → match to active journey → fire reply logic
- STOP/opt-out handling: auto-unsubscribe
- Urdu RTL template editor and preview
- WhatsApp analytics: delivery rate, read rate, reply rate, link click rate, opt-out rate, revenue attributed

**SMS (Twilio + local PK aggregator):**
- Twilio integration for international / fallback
- Local PK SMS aggregator integration for Pakistan (lower cost, higher deliverability)
- Automatic failover: if Twilio fails, try local aggregator

**Update file:** `updates/YYYY-MM-DD_phase6_whatsapp-sms-adapters.md`

---

### Milestone 6.4 — Email Channel & COD Verification Flows

**Email (AWS SES):**
- Drag-drop email builder: sections, images, buttons, dynamic product blocks, personalization tokens, conditional content blocks
- Mobile preview + spam score checker
- Domain verification + DKIM/SPF/DMARC auto-setup
- A/B testing: subject lines, sender name, send time, full variants
- Transactional email support (order confirmation, shipping)
- Dedicated IP pools for Pro plan

**COD Verification Flows:**
- Option A: WhatsApp verification (YES/NO reply)
- Option B: SMS verification
- Option C: IVR call via Fixerr AI integration
- Configurable thresholds: no-reply window → reminder → auto-cancel
- Verification analytics dashboard

**Update file:** `updates/YYYY-MM-DD_phase6_email-cod-verification.md`

---

### Milestone 6.5 — On-Site Personalization & Pre-Built Flow Library

**On-Site Personalization:**
- Popup builder: welcome, exit intent, cart value, timed
- Sticky bar builder: flash sale, free shipping threshold, countdown timer
- Segment-specific display rules
- A/B testing per element
- SDK renders elements server-configured by EngageIQ (no Shopify theme changes)

**Pre-Built Flow Library:**
- Implement all 50+ flows from the feature guide as importable JSON journey templates:
  - Abandoned cart (5 variants)
  - Welcome series (4 variants)
  - Post-purchase (6 variants)
  - Win-back (4 variants)
  - Loyalty & VIP (3 variants)
  - COD-specific (5 variants)
- One-click activate and customize

**Update file:** `updates/YYYY-MM-DD_phase6_onsite-prebuilt-flows.md`

---

## Phase 7 — AI & Intelligence Layer

**Goal:** Add the ML models and AI features that differentiate EngageIQ from basic automation tools.

### Milestone 7.1 — Churn Prediction Model

- Python microservice (FastAPI): train gradient boosted classifier (XGBoost / LightGBM) on features: days since last purchase, purchase frequency trend, AOV trend, email engagement trend, WhatsApp reply rate, inter-purchase gap, RFM trajectory, session activity
- Weekly batch scoring job: score all customers → write `churn_score` + `churn_risk_label` to PostgreSQL
- Trigger rule: "when churn score crosses threshold → enroll in journey"
- Churn score displayed on customer profile and usable in segment builder

**Update file:** `updates/YYYY-MM-DD_phase7_churn-prediction.md`

---

### Milestone 7.2 — LTV Prediction & Product Recommendations

**LTV Prediction:**
- BG/NBD model (purchase probability) + Gamma-Gamma model (spend prediction)
- Predict `ltv_90d`, `ltv_180d`, `ltv_365d` per customer
- Weekly batch job; results written to customer profile
- Usable in segment builder and campaign targeting

**Product Recommendation Engine:**
- Collaborative filtering (implicit feedback: purchases + views)
- Recommendation types: "customers like you also bought", "you might also like", "complete the look", "time to restock"
- Served via `/api/v1/recommendations/:customer_id`
- Plugged into email dynamic product blocks and WhatsApp personalization

**Update file:** `updates/YYYY-MM-DD_phase7_ltv-recommendations.md`

---

### Milestone 7.3 — Fake Order Scoring (COD ML Model)

- Feature engineering: phone number quality, address parsability, address duplication across accounts, order pattern (first order + high value), customer COD history, area risk score, item-level signals, velocity signals
- Train binary classifier: fake vs. legitimate COD order
- Real-time scoring: score within seconds of order placement (synchronous call in webhook processor)
- Merchant-configurable thresholds: 0–40 process normally, 41–70 require verification, 71–100 auto-cancel / hold
- Model retraining pipeline: confirmed fakes + successful deliveries feed back into training data
- Fake score visible on COD order and customer profile

**Update file:** `updates/YYYY-MM-DD_phase7_fake-order-scoring.md`

---

### Milestone 7.4 — AI Copywriter

- Integrate Anthropic Claude API
- Campaign copy generation: email subject lines, WhatsApp message body, SMS copy
- Context inputs: campaign goal, target segment description, offer, tone, language (English / Urdu)
- Generate 3 variants per request
- Subject line predicted open rate (based on historical + benchmark data)
- Urdu copy generation (Claude handles RTL script quality)
- Review-before-send gate: AI copy is never sent without merchant approval

**Update file:** `updates/YYYY-MM-DD_phase7_ai-copywriter.md`

---

## Phase 8 — Platform & Integrations

**Goal:** Production-ready integrations, API surface, and access control.

### Milestone 8.1 — Courier Integrations (Pakistan-Specific)

Integrate with all four couriers via their respective APIs:

- **PostEx** — real-time delivery status, COD collection confirmation
- **Leopards Courier** — tracking, delivery confirmation, return data
- **TCS Couriers** — tracking and status
- **M&P (Mubashir and Partners)** — tracking and delivery

On delivery confirmed → trigger post-purchase automation flow
On delivery returned → trigger return flow + update customer COD acceptance rate

**Update file:** `updates/YYYY-MM-DD_phase8_courier-integrations.md`

---

### Milestone 8.2 — REST API, Outbound Webhooks & Shopify App Store Prep

**Public REST API:**
- `GET /api/v1/customers/:id` — read profile
- `GET /api/v1/segments/:id/members` — list segment members
- `POST /api/v1/campaigns/:id/trigger` — trigger campaign programmatically
- `GET /api/v1/analytics/*` — pull analytics for external dashboards
- `POST /api/v1/segments` — create segment via API
- Full OpenAPI spec generated

**Outbound Webhooks:**
- Merchant-configurable webhook endpoints
- Events: customer enters/exits segment, campaign completes, COD verification result, churn score threshold crossed
- Retry logic with exponential backoff

**Shopify App Store Prep:**
- App listing copy, screenshots, privacy policy
- Shopify app review checklist compliance
- GDPR webhooks: `customers/data_request`, `customers/redact`, `shop/redact`

**Update file:** `updates/YYYY-MM-DD_phase8_api-webhooks-appstore.md`

---

### Milestone 8.3 — Full RBAC & Agency Accounts

- Enforce all six roles across every API route and dashboard view
- Agency parent account: create child merchant accounts, switch between dashboards
- Agency Member: access only assigned child accounts
- White-label export: generate client-branded PDF/CSV reports
- Billing: PKR pricing plans (Starter: Rs. 4,999/mo, Growth, Pro, Enterprise)

**Update file:** `updates/YYYY-MM-DD_phase8_rbac-agency.md`

---

## Phase 9 — South Asia Specialization

**Goal:** Polish and complete all South Asia-specific features that define the product's market position.

### Milestone 9.1 — Urdu-First Campaign Support

- RTL text input in email builder (right-to-left rendering)
- Urdu WhatsApp template creation and submission interface
- Bilingual A/B testing: same campaign, Urdu variant vs. English variant — measure which performs better per segment
- Customer language preference field on profile; segment by language
- AI copywriter Urdu quality review checklist

**Update file:** `updates/YYYY-MM-DD_phase9_urdu-support.md`

---

### Milestone 9.2 — COD Intelligence Stack Polish

End-to-end COD lifecycle review and hardening:
- COD order detection → fake scoring → verification flow → courier tracking → acceptance/rejection → profile update → post-rejection win-back
- COD-to-prepaid conversion campaign templates
- COD analytics dashboard full feature parity
- City-level heatmap (Pakistan choropleth) using real courier rejection data
- IVR (Fixerr AI) full integration test with live calls

**Update file:** `updates/YYYY-MM-DD_phase9_cod-stack-polish.md`

---

### Milestone 9.3 — AI Model Calibration for South Asian Commerce

- Recalibrate RFM thresholds using PKR-denominated order value distributions
- Add Eid / Ramadan seasonal spike handling to churn model (suppress false churn signals during shopping festivals)
- Calibrate LTV model on South Asian repurchase cycle patterns
- Fake order model: incorporate Pakistan-specific address and phone validation (PTCL / Jazz / Telenor / Zong number validation)
- Validate churn model and LTV model against real merchant data (backtesting)

**Update file:** `updates/YYYY-MM-DD_phase9_model-calibration.md`

---

## Phase 10 — QA, Hardening & Launch

**Goal:** Production-ready. No known critical bugs. Deployed. Monitored.

### Milestone 10.1 — End-to-End Testing & Performance

- E2E test suite (Playwright): full user flows — install Shopify app, receive webhook, view profile, build segment, activate journey, send campaign, view analytics
- Load testing (k6): webhook ingestion at 1,000 events/sec; campaign sends to 100K segment; ClickHouse query response times under load
- PostgreSQL query optimization: add indexes, analyze slow queries with EXPLAIN ANALYZE
- ClickHouse query optimization: review materialized views for high-frequency analytics queries

**Update file:** `updates/YYYY-MM-DD_phase10_e2e-performance.md`

---

### Milestone 10.2 — Security Audit

- Input validation on all API endpoints (zod schemas)
- SQL injection prevention (parameterized queries only)
- HMAC validation on all Shopify webhooks
- Rate limiting on all public endpoints
- API key rotation UI for merchants
- OWASP Top 10 review
- Secrets management: no secrets in code; all via environment variables / AWS Secrets Manager
- Data isolation audit: confirm no cross-tenant data leakage in any query

**Update file:** `updates/YYYY-MM-DD_phase10_security-audit.md`

---

### Milestone 10.3 — Observability & Monitoring

- Structured logging (JSON) with request IDs on every Fastify route
- BullMQ dashboard (Bull Board) for queue monitoring
- Error tracking: Sentry integration (API + frontend)
- Uptime monitoring: health check endpoints for all services
- Alerting: PagerDuty / Slack alerts for queue depth spikes, error rate spikes, webhook delivery failures
- ClickHouse query performance dashboard

**Update file:** `updates/YYYY-MM-DD_phase10_observability.md`

---

### Milestone 10.4 — Beta Launch

- Onboard 3–5 pilot merchants (Pakistani Shopify brands)
- Deploy to AWS (ECS + RDS + ElastiCache + ClickHouse Cloud)
- Set up CI/CD pipeline (GitHub Actions: test → build → deploy)
- Domain + SSL
- Shopify App Store submission
- Monitor for 2 weeks; address all P0/P1 issues
- Document onboarding flow for first paying customers

**Update file:** `updates/YYYY-MM-DD_phase10_beta-launch.md`

---

## Summary Table

| Phase | Milestones | Key Deliverable |
|---|---|---|
| 1 | 1.1–1.4 | Working scaffold, databases, auth |
| 2 | 2.1–2.4 | Shopify data flowing in, SDK tracking |
| 3 | 3.1–3.3 | Unified profiles, identity resolution, multi-store |
| 4 | 4.1–4.5 | Full analytics suite |
| 5 | 5.1–5.3 | Segment builder + dynamic evaluation + AI discovery |
| 6 | 6.1–6.5 | Journey builder, all channels, COD verification, flow library |
| 7 | 7.1–7.4 | Churn, LTV, fake order ML, AI copywriter |
| 8 | 8.1–8.3 | Courier integrations, public API, RBAC, App Store |
| 9 | 9.1–9.3 | Urdu, COD polish, South Asia model calibration |
| 10 | 10.1–10.4 | QA, security, monitoring, beta launch |

**Total milestones: 38**

---

*EngageIQ Roadmap v1.0 — Swift Studioz, Lahore, Pakistan*
*Confidential — Internal Use*
