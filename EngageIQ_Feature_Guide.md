# EngageIQ — Full Product & Feature Guide

> **Built by Swift Studioz, Lahore, Pakistan**
> WhatsApp-First. COD-Native. South Asia-Ready.

---

## Table of Contents

1. [Project Description](#1-project-description)
2. [Who Is This For](#2-who-is-this-for)
3. [Architecture Overview](#3-architecture-overview)
4. [Layer 1 — Data Infrastructure](#4-layer-1--data-infrastructure)
5. [Layer 2 — Analytics Engine](#5-layer-2--analytics-engine)
6. [Layer 3 — Segmentation Engine](#6-layer-3--segmentation-engine)
7. [Layer 4 — Campaign & Automation Engine](#7-layer-4--campaign--automation-engine)
8. [Layer 5 — AI & Intelligence](#8-layer-5--ai--intelligence)
9. [Layer 6 — Platform & Integrations](#9-layer-6--platform--integrations)
10. [Unique Features — South Asia First](#10-unique-features--south-asia-first)
11. [Tech Stack](#11-tech-stack)
12. [Data Models](#12-data-models)

---

## 1. Project Description

EngageIQ is a full-stack customer engagement platform built specifically for Shopify merchants in South Asia and the MENA region. It is the operational equivalent of CleverTap or Klaviyo, but designed from the ground up for markets where:

- **Cash on Delivery (COD)** is the dominant payment method (70%+ of orders in Pakistan)
- **WhatsApp** is the primary communication channel (90%+ open rate vs 18% for email)
- **Urdu and Arabic** are the languages of conversion, not English
- **Multi-brand marketplace operators** run 3–10 Shopify stores simultaneously with no unified view
- **PKR pricing** makes Western SaaS tools inaccessible for most local merchants

The platform connects to Shopify stores via webhook and API, ingests all customer and order data in real time, builds unified customer profiles, scores customers using RFM and AI models, and lets merchants run automated, personalized campaigns across WhatsApp, Email, SMS, and Web Push from a single dashboard.

### What Problem It Solves

Today, a Pakistani Shopify brand doing Rs. 5M/month in revenue has to use:

- Klaviyo (email) — $100/month, no COD awareness, no Urdu
- A separate WhatsApp tool — Rs. 5,000–15,000/month, no Shopify sync
- A separate analytics tool — another subscription
- A separate loyalty app — another subscription
- A manual process for COD verification — 2–3 staff members calling customers

EngageIQ replaces all five with one platform, billed in PKR, that understands how South Asian e-commerce actually works.

### What Makes It Different from CleverTap / Klaviyo

| Capability | CleverTap | Klaviyo | EngageIQ |
|---|---|---|---|
| WhatsApp as primary channel | Bolt-on | No | Native, first-class |
| COD order awareness | No | No | Full COD logic |
| COD fake order scoring | No | No | ML model built-in |
| Urdu campaign support | No | No | Full RTL + Urdu |
| Multi-store unified profiles | No | No | Core feature |
| PKR pricing | No | No | Yes |
| South Asia courier integrations | No | No | PostEx, Leopards, TCS |
| SKU-level retention analytics | No | No | Yes |
| Price | $75K+/year | $100+/month | From Rs. 4,999/month |

---

## 2. Who Is This For

### Primary Users

**Shopify Merchants (SME to Mid-Market)**
Brands doing Rs. 500K to Rs. 50M/month. They have a customer base but no proper system to engage, retain, or understand them. They are running campaigns manually or using basic email tools with no COD or WhatsApp capability.

**Marketplace Operators**
Brands like ZARR running multiple Shopify stores under different labels. They need cross-store customer intelligence, unified revenue reporting, and the ability to run campaigns that reference behavior across their entire brand portfolio.

**Digital Marketing Agencies**
Agencies managing 5–30 Shopify brand clients. They need a white-label-capable platform with multi-client account management, client-level reporting, and exportable assets.

### Secondary Users (Future)

- WooCommerce stores (Phase 4 integration)
- D2C brands in UAE, Saudi Arabia, Bangladesh
- Global mid-market brands wanting WhatsApp automation

---

## 3. Architecture Overview

EngageIQ is built as a multi-tenant SaaS platform with the following high-level flow:

```
Shopify Store(s)
      |
      | (Webhooks + Admin API)
      v
[Ingestion Layer]  ←  Storefront SDK (JS)  ←  Custom Event API
      |
      v
[Event Processing Queue]  (BullMQ + Redis)
      |
      v
[Data Store]
  PostgreSQL (profiles, segments, campaigns)
  ClickHouse (event analytics — high-volume, fast queries)
  Redis (session cache, real-time counters)
      |
      v
[Processing Layer]
  RFM Engine (daily batch)
  Segment Evaluator (real-time)
  AI/ML Service (Python microservice)
      |
      v
[Campaign Engine]
  Journey Executor
  Channel Adapters (WhatsApp / Email / SMS / Push)
  Scheduler + Queue
      |
      v
[Dashboard]  (Remix or Next.js)
  Analytics Views
  Segment Builder
  Journey Builder
  Campaign Manager
```

### Key Architectural Decisions

**ClickHouse for Events** — All behavioral events (page views, product views, clicks, etc.) are stored in ClickHouse. This is a columnar database optimized for the exact query pattern needed: "how many customers viewed product X in the last 30 days, segmented by city." PostgreSQL would be too slow for this at any meaningful scale.

**BullMQ for Campaign Execution** — All campaign sends go through a job queue. This prevents thundering herd problems when sending to large segments, enables retry logic, and allows rate limiting per channel (WhatsApp enforces message-per-second limits).

**Multi-Tenant Isolation** — Every database query is scoped by `merchant_id`. Merchants cannot see each other's data. Agencies get a parent account with child merchant accounts under them.

**Shopify Webhook + Polling Hybrid** — Webhooks for real-time events (orders, customers). Scheduled polling as a fallback to catch any missed webhooks. This ensures no data loss.

---

## 4. Layer 1 — Data Infrastructure

This is the foundation. Everything else depends on getting clean, complete, real-time data into the platform.

---

### 4.1 Shopify Real-Time Data Sync

**What it is:**
A bidirectional connection between EngageIQ and a merchant's Shopify store. When anything happens in the store — a new order, a customer update, a refund, a product change — EngageIQ knows about it within seconds.

**How it works:**

1. Merchant installs the EngageIQ Shopify App (one click from App Store).
2. App registers Webhook subscriptions for all relevant topics on Shopify's side.
3. Shopify sends a POST request to EngageIQ's ingestion endpoint every time a subscribed event fires.
4. EngageIQ validates the HMAC signature on each webhook to confirm it's genuinely from Shopify.
5. The event is dropped into the processing queue and acknowledged immediately (Shopify requires a 200 response within 5 seconds).
6. The queue processor handles deduplication, transformation, and storage.

**Webhooks subscribed:**

- `orders/create` — New order placed
- `orders/updated` — Order status change (fulfilled, cancelled, refunded)
- `orders/paid` — Payment confirmed
- `customers/create` — New customer registered
- `customers/update` — Customer data changed (email, phone, address)
- `checkouts/create` — Checkout started (for abandoned cart detection)
- `checkouts/update` — Checkout updated
- `products/update` — Product or variant changes (price drop triggers, restock)
- `inventory_levels/update` — Stock level changes (restock notifications)
- `refunds/create` — Refund issued

**Historical backfill:**
On first install, EngageIQ uses the Shopify Admin REST API to pull the full historical order and customer history. This populates RFM scores and segments from day one, not just going forward.

**COD-specific handling:**
Orders with `payment_gateway = "cash on delivery"` or payment_status = `pending` are flagged as COD orders and routed through the COD processing pipeline (verification flows, fake order scoring).

---

### 4.2 Storefront Event Tracking SDK

**What it is:**
A lightweight JavaScript snippet (under 5KB gzipped) that merchants add to their Shopify theme. It captures everything a customer does on the storefront — before they ever place an order.

**Why this matters:**
Shopify webhooks only tell you what happened after a transaction. They don't tell you that a customer viewed a product 4 times over 3 days, searched for "blue kurta" but didn't find what they wanted, or spent 8 minutes on a product page and then bounced. This behavioral data is what powers the best segments and automation triggers.

**Events captured automatically:**

```
page_view          — Every page load (URL, referrer, device)
product_view       — Product detail page viewed (product_id, variant_id, price)
collection_view    — Category/collection page viewed
search_query       — Search term entered (query, results_count)
add_to_cart        — Item added to cart (product_id, variant_id, quantity, price)
remove_from_cart   — Item removed from cart
cart_view          — Cart page viewed
checkout_started   — Checkout flow begun
checkout_step      — Each checkout step completed (address, shipping, payment)
wishlist_add       — Product added to wishlist (if app installed)
product_image_zoom — Customer zoomed into a product image (high-intent signal)
scroll_depth       — How far down a page the customer scrolled (25%, 50%, 75%, 100%)
time_on_page       — Time spent on each page before navigating away
exit_intent        — Mouse moved toward browser close/back (desktop only)
```

**Identity stitching:**
Anonymous visitors get a temporary `anon_id` stored in a first-party cookie. When they log in or complete a purchase, their `anon_id` is linked to their `customer_id`. All historical anonymous events are retroactively attributed to the customer profile. This means a customer's journey from first visit to purchase is captured completely.

**Implementation:**
The SDK is injected automatically when the Shopify App is installed, via the App Embed Block feature in Shopify's theme architecture. No developer work required on the merchant's side.

---

### 4.3 Unified Customer Profile

**What it is:**
Every customer gets a single, comprehensive profile that aggregates all data about them from all sources. This is the core data object in EngageIQ — everything else reads from or writes to profiles.

**Profile structure:**

```
Customer Profile
├── Identity
│   ├── customer_id (Shopify)
│   ├── email
│   ├── phone (WhatsApp-formatted)
│   ├── name
│   └── anon_ids[] (historical anonymous sessions)
│
├── Shopify Data
│   ├── total_orders
│   ├── total_spent
│   ├── average_order_value
│   ├── first_order_date
│   ├── last_order_date
│   ├── last_order_id
│   ├── tags[]
│   ├── accepts_marketing
│   └── default_address
│
├── Behavioral Data (from SDK)
│   ├── last_seen_at
│   ├── session_count
│   ├── page_views_total
│   ├── product_views[]  (product_id, view_count, last_viewed_at)
│   ├── search_queries[]
│   ├── preferred_categories[]
│   └── device_types_used[]
│
├── RFM Scores
│   ├── recency_score  (1–5)
│   ├── frequency_score  (1–5)
│   ├── monetary_score  (1–5)
│   ├── rfm_segment  (Champion / Loyal / At-Risk / etc.)
│   └── last_scored_at
│
├── AI Scores
│   ├── ltv_predicted_90d
│   ├── ltv_predicted_180d
│   ├── ltv_predicted_365d
│   ├── churn_risk_score  (0–100)
│   ├── churn_risk_label  (Low / Medium / High / Critical)
│   └── next_best_action
│
├── COD Profile (Pakistan-specific)
│   ├── cod_orders_count
│   ├── cod_acceptance_rate
│   ├── cod_fake_order_score  (0–100)
│   ├── preferred_courier
│   └── return_rate
│
├── Campaign Engagement
│   ├── emails_sent / opened / clicked
│   ├── whatsapp_messages_sent / read / replied
│   ├── sms_sent / delivered
│   ├── push_sent / clicked
│   └── last_campaign_interaction_at
│
└── Segment Memberships
    └── segment_ids[]  (dynamically updated)
```

---

### 4.4 Identity Resolution

**What it is:**
The process of linking together multiple identifiers that belong to the same real person — anonymous browser sessions, different email addresses, phone numbers — into a single unified profile.

**Why it matters:**
Without identity resolution, a customer who browses your store on mobile (anonymous), then purchases on desktop (logged in), looks like two different people. You miss their full behavioral context, and your segment membership calculations are wrong.

**How EngageIQ resolves identity:**

1. **Email match:** If an anonymous session later submits an email (checkout, popup), match to existing profile with that email.
2. **Phone match:** Same as above for phone number, normalized to E.164 format.
3. **Shopify customer_id:** When a customer logs in, link all anonymous sessions from that browser.
4. **Cross-device:** Probabilistic matching on IP + User-Agent + behavior patterns for users who don't log in across devices (optional, privacy-preserving).
5. **Explicit merge:** Merchants can manually merge two customer profiles via the dashboard when a duplicate is identified.

**Conflict resolution:**
When two profiles are merged, the older profile ID is preserved as the canonical ID. All events, orders, and segments from the secondary profile are migrated. The secondary profile is marked as merged (not deleted) for audit purposes.

---

### 4.5 Custom Event API

**What it is:**
A REST API that lets merchants send any custom event into EngageIQ from any source — their backend, a mobile app, a loyalty system, a call center CRM, a physical POS.

**Why it matters:**
Not everything happens in the Shopify storefront. A customer might call the support line and place an order verbally. A customer might redeem loyalty points through a separate app. A customer might visit a physical store. All of these interactions should be part of their profile and can trigger automation flows.

**API structure:**

```http
POST /api/v1/events
Authorization: Bearer {merchant_api_key}
Content-Type: application/json

{
  "customer_email": "customer@example.com",
  "event_name": "loyalty_points_redeemed",
  "timestamp": "2025-04-15T14:30:00Z",
  "properties": {
    "points_redeemed": 500,
    "order_id": "12345",
    "remaining_balance": 1200
  }
}
```

**Supported customer identifiers:**
`customer_email`, `customer_phone`, `customer_id` (Shopify ID), or `anon_id`.

**Event properties:**
Any JSON object. Properties become queryable attributes in the segment builder — if you send `city: "Lahore"` as a property, merchants can segment on it.

**Rate limits:**
1,000 events/second per merchant on Growth plan. Enterprise: custom.

---

### 4.6 Multi-Store Data Unification

**What it is:**
The ability to connect multiple Shopify stores to a single EngageIQ account and view customers, revenue, and performance across all stores in one place.

**Why it matters:**
Marketplace brands like ZARR operate multiple stores (e.g., one per product category or brand). Without unification, they have no idea if the same customer shops across their stores, what their total spend across the portfolio is, or how to run a cross-store campaign.

**How it works:**

1. Merchant connects Store A, Store B, Store C to one EngageIQ account.
2. On ingestion, EngageIQ attempts to match customers across stores by email and phone.
3. Matched customers get a unified `group_customer_id` that links all store-specific profiles.
4. All analytics can be viewed at store level OR group level (consolidated).
5. Segments can be built on cross-store behavior: "Bought from Store A but never from Store B."
6. Campaigns can reference cross-store data in personalization: "You've spent Rs. 25,000 across our family of brands."

**What you can see in the unified view:**
- Total revenue across all stores
- Customer overlap between stores (what % shop at 2+ stores)
- Top customers by group-level spend
- Cross-store campaign performance

---

## 5. Layer 2 — Analytics Engine

---

### 5.1 Real-Time Dashboard

**What it is:**
The main home screen of the EngageIQ dashboard. Shows the current state of the business as it's happening.

**Metrics shown:**

- Live active visitors on storefront (refreshed every 30 seconds)
- Revenue today vs. yesterday vs. same day last week
- Orders today (total, COD vs. prepaid breakdown)
- New customers today vs. returning customers
- Active campaigns and their real-time performance
- Alerts (high churn risk segment spike, campaign anomaly, etc.)

**How to read it:**
The dashboard is designed for a merchant to open every morning and immediately know the health of their business. Color coding shows direction: green for above target, amber for at target, red for below. No configuration needed — it works from day one.

---

### 5.2 Funnel Analysis

**What it is:**
The ability to define a multi-step customer journey and see exactly where customers are dropping off.

**How to use it:**

1. Go to Analytics > Funnels.
2. Click "New Funnel."
3. Add steps: e.g., Step 1 = `product_view`, Step 2 = `add_to_cart`, Step 3 = `checkout_started`, Step 4 = `order_created`.
4. Apply filters: date range, product category, traffic source, customer segment.
5. View the funnel: shows how many customers entered at Step 1, how many completed each subsequent step, and the drop-off rate between each step.

**Example output:**
```
Product View         12,450 customers  (100%)
Add to Cart           3,735 customers  (30%)   ← 70% drop
Checkout Started      1,868 customers  (15%)   ← 50% drop
Order Placed          1,307 customers  (10.5%) ← 30% drop
```

**What to do with it:**
The biggest drop-off point is the highest-leverage optimization opportunity. 70% of people who view a product don't add to cart — that's a product page problem (price, images, description). 50% of people who add to cart don't start checkout — that's an abandoned cart opportunity for automation.

**Funnel comparison:**
Compare the same funnel across two time periods, two product categories, or two customer segments side by side.

---

### 5.3 Cohort Retention Analysis

**What it is:**
Groups customers by the period they first purchased and tracks what percentage return to buy in subsequent periods.

**Why it matters:**
This is the single most important metric for an e-commerce business. If 100 customers bought in January, how many came back in February? March? June? A business where customers never return is a business that's constantly spending on acquisition. A business with strong retention compounds.

**How to read a cohort table:**

```
Cohort    | Size  | Month 1 | Month 2 | Month 3 | Month 6
Jan 2025  | 1,240 |   100%  |   32%   |   21%   |   14%
Feb 2025  |   980 |   100%  |   28%   |   19%   |   —
Mar 2025  | 1,450 |   100%  |   35%   |   —     |   —
```

Month 1 is always 100% (they all purchased). Month 2 shows what % came back the next month. The goal is to see these numbers trending up over time as retention programs improve.

**Filters available:**
Product category cohorts (customers who first bought from Category X), channel cohorts (customers acquired via WhatsApp campaign), and RFM cohorts.

---

### 5.4 RFM Scoring Engine

**What it is:**
Recency, Frequency, Monetary (RFM) is the gold standard scoring system for e-commerce customer value. Every customer is scored on three dimensions and assigned to a named segment.

**How scoring works:**

- **Recency (R):** Days since last purchase. Score 1 (bought long ago) to 5 (bought recently).
- **Frequency (F):** Number of purchases in the lookback period. Score 1 (one-time) to 5 (frequent).
- **Monetary (M):** Total amount spent. Score 1 (low spend) to 5 (high spend).

Scores are calculated relative to your customer base (not absolute numbers). A customer with a score of 5-5-5 is your best customer. A customer with 1-1-1 is your worst.

**Named segments automatically assigned:**

| Segment | R | F | M | Description |
|---|---|---|---|---|
| Champion | 5 | 5 | 5 | Bought recently, buys often, spends most |
| Loyal Customer | 4-5 | 3-5 | 3-5 | Regular buyers, good spend |
| Potential Loyalist | 4-5 | 1-2 | 1-2 | Recent but few purchases |
| New Customer | 5 | 1 | 1 | First purchase very recently |
| Promising | 3-4 | 1 | 1 | Recent, hasn't bought much yet |
| Need Attention | 3 | 3 | 3 | Above average, but fading |
| About to Sleep | 2 | 1-2 | 1-2 | Below average, becoming inactive |
| At Risk | 2 | 3-5 | 3-5 | Used to buy often, not recently |
| Cannot Lose Them | 1 | 4-5 | 4-5 | Made big purchases, haven't returned |
| Hibernating | 1-2 | 1-2 | 1-2 | Low activity, long time ago |
| Lost | 1 | 1 | 1 | Lowest scores across all dimensions |

**Update frequency:**
RFM scores are recalculated every 24 hours for all customers. Score changes trigger segment re-assignment automatically.

**How to use RFM:**
Each segment has a different recommended action. Champions get VIP treatment and referral requests. At-Risk customers get win-back campaigns. Cannot Lose Them get personal outreach via WhatsApp. Lost customers get re-engagement offers.

---

### 5.5 Revenue Attribution

**What it is:**
The ability to see which campaigns, channels, and automations are actually responsible for driving revenue — not just clicks, but actual purchases.

**Attribution models supported:**

- **Last touch:** Credit given to the last campaign interaction before purchase.
- **First touch:** Credit given to the first campaign that brought the customer to the purchase journey.
- **Linear:** Credit split equally across all touchpoints before purchase.
- **Time decay:** More credit given to touchpoints closer in time to the purchase.

**What gets tracked:**

Every campaign send gets a unique UTM-style tracking parameter. When a customer clicks through and purchases within the attribution window (default: 7 days for email, 24 hours for SMS/push, 3 days for WhatsApp), the purchase is attributed to that campaign.

**Dashboard view:**
Revenue by channel (Email: Rs. X, WhatsApp: Rs. Y, SMS: Rs. Z, Push: Rs. W). Revenue by campaign. Revenue by automation flow. ROI per campaign (revenue generated divided by cost of send).

---

### 5.6 Product-Level Retention Analytics

**What it is:**
Measuring retention not just at the customer level, but at the product and SKU level. Which products are driving repeat buyers? Which are dead ends?

**Metrics per product:**

- **Repurchase rate:** What % of customers who bought this product bought it again within 90 days?
- **Cross-sell rate:** What % of customers who bought this product went on to buy another product? And which products?
- **LTV of buyers:** Average predicted LTV of customers who purchased this product (products that attract high-LTV customers are worth investing more in).
- **Return rate:** What % of units sold were returned?
- **Time to second purchase:** For customers who did repurchase, how many days after the first purchase?

**Why this matters:**
A product with a 40% repurchase rate is fundamentally more valuable to the business than one with 5%, even if they have similar margins. This insight changes inventory decisions, ad spend allocation, and which products to feature in retention campaigns.

---

### 5.7 COD Analytics Dashboard

**What it is:**
A dedicated analytics view for Cash on Delivery order performance — a category that simply doesn't exist in any Western platform.

**Metrics tracked:**

- **COD acceptance rate:** Of all COD orders dispatched, what % were successfully collected by the courier?
- **COD rejection rate:** By city, by courier, by product category, by order value range.
- **Fake order rate:** Orders identified as fake (customer wasn't home, phone unreachable, confirmed fake by merchant).
- **COD-to-prepaid conversion rate:** Of customers who started on COD, what % have been converted to prepaid payment?
- **Average days to collect:** How long from dispatch to cash collection, by courier.
- **Net revenue from COD vs. prepaid:** Accounting for rejection losses, which is actually more profitable?

**City-level heatmap:**
A visual map of Pakistan showing COD acceptance rate by city. Merchants can see that orders to Quetta have a 45% rejection rate and adjust their COD policy for that region.

---

## 6. Layer 3 — Segmentation Engine

---

### 6.1 Behavioral Segment Builder

**What it is:**
A visual query builder that lets merchants create customer segments using any combination of behavioral events, profile attributes, and computed scores — without writing any code.

**How it works:**

The builder has three types of conditions:

**Event conditions** — things the customer has done:
```
"has done" / "has not done"  +  [event name]  +  [count]  +  [time window]
Example: "Has done: product_view  3 or more times  in the last 7 days"
```

**Property conditions** — things we know about the customer:
```
[attribute]  +  [operator]  +  [value]
Example: "City  is  Lahore"
Example: "Total spent  is greater than  Rs. 10,000"
Example: "RFM segment  is  At Risk"
```

**Combining conditions:**
- AND: Customer must match all conditions
- OR: Customer must match any condition
- NOT: Customer must not match the condition
- Nested groups: (Condition A AND Condition B) OR (Condition C)

**Example complex segment:**
```
(
  Product view: "Blue Kurta" >= 2 times in last 14 days
  AND
  Add to cart: 0 times in last 14 days
  AND
  RFM Segment: Potential Loyalist OR Loyal Customer
)
AND
NOT (
  Order placed: any, in last 14 days
)
```

Translation: "Customers who are showing high interest in the Blue Kurta (viewed it multiple times) but haven't bought it, who are otherwise good customers, and who haven't ordered anything recently." This is a segment worth targeting with a personalized WhatsApp message and a small discount.

---

### 6.2 Dynamic Segments

**What it is:**
Segments that update in real time as customer behavior changes. A customer enters the segment the moment they meet the criteria and exits the moment they no longer do.

**Why this matters:**
Static segments (calculated once per day or week) miss the window. If a customer adds something to their cart and you only check segments once per day, you might trigger the abandoned cart message 18 hours later instead of 1 hour later. Dynamic segments power real-time automation.

**How it works technically:**
When an event is ingested, the segment evaluator checks which segment definitions could be affected by this event type. It then re-evaluates only the relevant customer against those segment conditions. This is more efficient than re-evaluating all segments for all customers.

**Segment size counter:**
Each segment shows a live count of members. Merchants can see their segment membership change as new events come in.

---

### 6.3 AI Segment Discovery

**What it is:**
An AI-powered feature that looks at your entire customer base, runs clustering algorithms, and surfaces meaningful customer groups that the merchant hasn't explicitly defined.

**What it surfaces:**

- Hidden clusters with shared behavioral patterns (e.g., "customers who browse late at night and prefer a specific category")
- Segments with surprisingly high LTV that aren't being targeted
- Segments that are showing early churn signals across the board
- Untapped segments ready for upsell (high engagement, low spend)

**Output format:**
Each discovered segment shows: estimated size, average LTV, recommended action, and a one-click button to create an official segment and attach an automation flow.

---

## 7. Layer 4 — Campaign & Automation Engine

---

### 7.1 Visual Journey Builder

**What it is:**
A drag-and-drop canvas for building multi-step, multi-channel automation flows. The merchant's most powerful tool for setting up sequences that run on autopilot.

**Canvas elements:**

**Triggers** (entry points for a journey):
- Customer enters a segment
- Event fires (e.g., `checkout_abandoned`, `order_created`)
- Scheduled time (e.g., "Every Monday at 10am for segment X")
- Manual trigger (one-time campaign send)
- COD order placed
- COD verification completed / failed
- Churn score crosses threshold

**Actions** (things that happen in the journey):
- Send WhatsApp message (template or open conversation)
- Send Email
- Send SMS
- Send Push Notification
- Show on-site popup (next session)
- Update customer tag in Shopify
- Add / remove from segment
- Trigger COD verification call
- Send webhook to external system

**Conditions / Branches** (split the journey based on):
- Did the customer open / click the previous message? (Yes / No branch)
- Is the customer in segment X? (Yes / No branch)
- Is COD order value above Rs. X? (Yes / No branch)
- What is the customer's churn score?
- What device is the customer on?
- A/B split (randomly route X% to Branch A, Y% to Branch B)

**Time delays:**
- Wait X hours / days
- Wait until specific time of day
- Wait until customer's best send time (AI-calculated)

**Example journey: Abandoned Cart with COD awareness:**
```
Trigger: checkout_abandoned
  │
  Wait: 1 hour
  │
  Condition: Is order payment method COD?
  │           │
  Yes         No
  │           │
  WhatsApp:   Email:
  "Your cart  "You left
  is waiting  something
  — COD       in your cart"
  available"
  │           │
  Wait: 24h   Wait: 24h
  │           │
  Condition: Did they purchase? (Yes → End | No → continue)
  │
  WhatsApp: Final nudge with 5% discount code
  │
  Wait: 48h
  │
  Condition: Did they purchase? (Yes → End | No → End journey)
```

---

### 7.2 WhatsApp Automation (First-Class Channel)

**What it is:**
Deep, native WhatsApp integration using the Meta Cloud API (WhatsApp Business API). Not a third-party connector — fully integrated as a primary channel with its own analytics, template management, and conversation handling.

**What merchants can do:**

**Template Message Campaigns:**
Pre-approved WhatsApp message templates sent at scale. Templates require Meta approval (24–72 hours). EngageIQ has a template submission and approval tracking interface built in.

**Template categories supported:**
- Utility (order confirmations, shipping updates, COD verification)
- Marketing (promotions, product launches, cart recovery)
- Authentication (OTP — not typically used for retail)

**Two-way Conversation Flows:**
Automated flows that send a message and respond based on the customer's reply. Example:

```
EngageIQ sends: "Your COD order is ready to ship. 
                 Reply CONFIRM to proceed or CANCEL to cancel."
Customer replies: "CONFIRM"
EngageIQ triggers: dispatch webhook + sends tracking message
Customer replies: "CANCEL"  
EngageIQ triggers: cancellation flow + notifies merchant
```

**WhatsApp Analytics:**
- Delivery rate (delivered to device)
- Read rate (blue ticks)
- Reply rate
- Link click rate (using WhatsApp's native link tracking)
- Opt-out rate (customer blocks business)
- Revenue attributed

**Compliance:**
WhatsApp has strict rules about marketing messages. EngageIQ enforces: 24-hour conversation window rules, opt-in requirement tracking, and opt-out handling. Customers who reply "STOP" are automatically unsubscribed.

**Urdu template support:**
Templates can be created and submitted in Urdu. EngageIQ's template editor supports RTL text input and preview.

---

### 7.3 Email Marketing

**What it is:**
A full-featured email marketing and automation tool with a drag-drop builder, deep Shopify product integration, and A/B testing.

**Email Builder features:**

- Drag-drop section editor (text, image, button, divider, spacer)
- **Dynamic product blocks:** Pull live products directly from the Shopify catalog into the email. Show "Products you viewed" or "Top sellers this week" that update automatically at send time.
- **Personalization tokens:** `{{customer.first_name}}`, `{{order.total}}`, `{{product.title}}`, any profile attribute.
- **Conditional content blocks:** Show different content to different segments within the same email send. One email template, personalized by segment.
- Mobile preview — see exactly how the email looks on mobile before sending.
- Spam score checker — flags issues before send.

**Sending infrastructure:**
AWS SES as the primary sending infrastructure with domain authentication (DKIM, SPF, DMARC) set up automatically on merchant domain verification. Dedicated IP pools for high-volume merchants on Pro plan.

**A/B Testing:**
Test subject lines, sender names, send times, or entire email variants. Statistical significance is calculated automatically. The winning variant is sent to the remaining audience.

**Transactional Emails:**
EngageIQ can optionally handle transactional emails (order confirmations, shipping notifications) in addition to marketing, replacing Shopify's default templates with fully branded, customizable versions.

---

### 7.4 COD Verification Flows

**What it is:**
An automated system that contacts customers who place COD orders to verify their intent before the order is dispatched. This is one of EngageIQ's most financially impactful features for Pakistani merchants.

**The problem it solves:**
Pakistani merchants report 15–40% of COD orders are "fake" — placed by bots, competitors, or customers who have no intention of accepting delivery. Each fake order costs the merchant shipping fees (both ways), packaging cost, and staff time. A brand doing 500 COD orders/month with 25% fake rate is losing Rs. 50,000–150,000/month in wasted logistics costs.

**Verification flow options:**

**Option A — WhatsApp Verification (recommended):**
```
Order placed (COD) → Wait 15 minutes → Send WhatsApp:
"Assalam-o-Alaikum! We've received your order for [Product] 
worth Rs. [Amount]. Reply YES to confirm or NO to cancel. 
(Order #[number])"

Customer replies YES → Mark verified → Proceed to fulfillment
Customer replies NO → Cancel order → Notify merchant
No reply in 2 hours → Send second WhatsApp reminder
No reply in 4 hours → Flag for manual review / auto-cancel (merchant configurable)
```

**Option B — SMS Verification:**
Same logic but via SMS. Lower engagement but higher deliverability to feature phones.

**Option C — IVR Call (via Fixerr AI integration):**
Automated voice call in Urdu confirming the order. Customer presses 1 to confirm, 2 to cancel. Works for customers who don't read WhatsApp.

**Verification analytics:**
- Verification rate (% who respond)
- Confirmation rate (% who confirm)
- Cancellation rate (% who cancel)
- Auto-cancel rate (% who don't respond)
- Revenue saved (estimated based on prevented fake orders)

---

### 7.5 On-Site Personalization

**What it is:**
Dynamic popups, banners, and content shown on the Shopify storefront to specific customer segments. The website becomes a personalized channel, not a one-size-fits-all experience.

**Types of on-site elements:**

**Popups:**
- Welcome popup for new visitors (email capture with incentive)
- Exit intent popup (triggered when cursor moves toward browser close)
- Cart value popup ("Add Rs. 500 more for free shipping!")
- Timed popup (shown after 30 seconds on site)

**Sticky Bars:**
- Flash sale announcement bar (shown only to segment X)
- Free shipping threshold bar ("You're Rs. 800 away from free shipping")
- Countdown timer bar (urgency for time-limited offers)

**Segment-specific display rules:**
- Show the "VIP early access" popup only to customers in the Champion segment
- Show the "First time? Here's 10% off" popup only to anonymous visitors
- Show the "Welcome back, [Name]!" popup to returning logged-in customers
- Show restock notification popup on a product page only to customers who previously viewed that product

**A/B testing:**
Each on-site element can be A/B tested. Show Variant A to 50% of the target segment, Variant B to the other 50%, measure which drives more conversions.

---

### 7.6 Pre-Built Flow Library

**What it is:**
A library of 50+ pre-built automation flows that merchants can activate with one click and customize. No need to build journeys from scratch.

**Categories and examples:**

**Abandoned Cart Flows (5 variants):**
- Single-channel email sequence (1h, 24h, 72h)
- WhatsApp-first (1h WhatsApp, 24h email, 48h SMS)
- COD-specific abandoned cart (with COD payment option highlighted)
- High-value cart abandoned (order > Rs. 5,000 — more aggressive recovery)
- Browse abandonment (viewed product but never added to cart)

**Welcome Series (4 variants):**
- New customer welcome + first purchase incentive
- WhatsApp welcome flow for customers who opted in
- Email welcome series (3-part: welcome, brand story, bestsellers)
- VIP welcome for first orders above threshold

**Post-Purchase Flows (6 variants):**
- Order confirmation + shipping update sequence
- Post-delivery review request
- Post-purchase cross-sell (based on what they bought)
- Post-purchase loyalty points notification
- COD post-delivery thank you + next purchase incentive
- Return / refund empathy flow

**Win-Back Flows (4 variants):**
- 30-day lapsed customer win-back
- 60-day lapsed customer aggressive win-back
- "We miss you" sequence with escalating discounts
- High-value lapsed customer personal WhatsApp outreach

**Loyalty & VIP Flows (3 variants):**
- VIP tier upgrade notification
- Birthday/anniversary flow
- Loyalty points expiry reminder

**COD-Specific Flows (5 variants):**
- COD verification (WhatsApp)
- COD verification (SMS + IVR fallback)
- COD-to-prepaid conversion campaign
- Post-rejection win-back ("We noticed your delivery wasn't accepted")
- High fake-score order review alert

---

## 8. Layer 5 — AI & Intelligence

---

### 8.1 Churn Prediction Model

**What it is:**
A machine learning model that assigns every customer a churn risk score from 0 to 100 and a risk label. Updated weekly.

**Features used by the model:**
- Days since last purchase (most important)
- Purchase frequency trend (buying more or less over time?)
- Average order value trend
- Email engagement trend (open rates declining?)
- WhatsApp reply rate
- Time between purchases (is the gap lengthening?)
- RFM score trajectory
- Product category purchased (some categories have naturally lower repurchase)
- Session activity (still visiting the store?)

**Churn risk labels and recommended actions:**

| Score | Label | Recommended Action |
|---|---|---|
| 0–25 | Low Risk | Standard engagement |
| 26–50 | Medium Risk | Increase engagement frequency |
| 51–75 | High Risk | Launch win-back sequence |
| 76–100 | Critical | Personal WhatsApp outreach |

**Automation integration:**
Merchants can set up trigger rules: "When a customer's churn score crosses 75, automatically enroll them in the win-back flow." No manual intervention needed.

---

### 8.2 LTV Prediction

**What it is:**
A model that predicts each customer's revenue contribution over the next 90, 180, and 365 days based on their current behavior and historical patterns.

**Why it matters:**
LTV prediction allows merchants to make smarter decisions: spend more on retaining high-predicted-LTV customers, identify which acquisition channels are bringing in high-LTV customers (and double down), and prioritize customer service resources.

**How the model works:**
Uses a BG/NBD (Buy Till You Die) model for purchase probability combined with a Gamma-Gamma model for spend prediction. These are the industry-standard models for e-commerce LTV prediction, developed by academic researchers and used by companies like Amazon.

**Displayed on:**
- Individual customer profiles (their predicted LTV)
- Segment builder (filter by predicted LTV range)
- Campaign targeting (target top 20% by predicted LTV for VIP campaigns)

---

### 8.3 AI Copywriter

**What it is:**
An LLM-powered tool that generates campaign copy — email subject lines, WhatsApp message text, SMS copy — based on context about the campaign, the target segment, and the merchant's brand voice.

**How to use it:**

1. Open a campaign or flow step.
2. Click "Generate with AI."
3. Provide context:
   - Campaign goal (cart recovery, win-back, promotion)
   - Target segment (VIP customers, At-Risk, New customers)
   - Offer (if any)
   - Tone (formal, casual, urgent, friendly)
   - Language (English or Urdu)
4. AI generates 3 variants.
5. Merchant picks one, edits as needed, or asks for more variants.

**Subject line predictor:**
After writing an email subject line (manually or AI-generated), the platform shows a predicted open rate based on historical performance of similar subject lines in the merchant's account and industry benchmarks.

**Urdu copy generation:**
The AI can generate marketing copy in Urdu using Claude or GPT-4. Merchants review and approve before sending (AI Urdu is good but should be reviewed by a native speaker for tone).

---

### 8.4 Product Recommendation Engine

**What it is:**
A collaborative filtering system that determines which products each customer is most likely to purchase next, based on what similar customers have bought.

**Recommendation types:**

- **"Customers like you also bought"** — Cross-sell recommendations based on purchase history patterns.
- **"You might also like"** — Based on browsing behavior (products viewed but not bought).
- **"Complete the look"** — For fashion: products frequently bought together.
- **"Time to restock"** — For consumable products: "It's been 30 days since you bought [Product]. Running low?"

**Where recommendations appear:**
- Email dynamic product blocks (auto-populated at send time with the right products for each customer)
- WhatsApp messages ("Based on your last purchase, you might love this…")
- On-site popups
- Post-purchase emails

---

### 8.5 Fake Order Scoring (COD-Specific)

**What it is:**
An ML model that assigns a fake order probability score (0–100) to every COD order within seconds of placement. High-score orders can be automatically held for verification.

**Signals used by the model:**

- **Phone number quality:** Is it a valid Pakistani mobile number? Has this phone number been associated with previous cancelled orders?
- **Address quality:** Is the address parseable and does it match a real location? Are there multiple orders to the exact same address from different accounts?
- **Order pattern:** Is this a first-ever order for a very high-value item (high risk)? Is the order placed at an unusual time?
- **Customer history:** Does this customer have a history of rejecting COD deliveries?
- **Area risk score:** Some neighborhoods or cities have historically higher rejection rates.
- **Item-level signals:** Certain product categories have higher fake order rates.
- **Velocity signals:** Multiple orders placed in quick succession from similar profiles.

**Merchant configurable thresholds:**
- Score 0–40: Process normally
- Score 41–70: Require WhatsApp verification before dispatch
- Score 71–100: Auto-cancel or hold for manual review

**Model improvement over time:**
Every confirmed fake order and every successful delivery is used to retrain the model. The longer EngageIQ is running, the better the model gets.

---

## 9. Layer 6 — Platform & Integrations

---

### 9.1 Shopify App

A native Shopify app listed on the Shopify App Store. One-click install. The app:

- Registers all required webhooks automatically.
- Injects the storefront tracking SDK via App Embed (no theme editing needed).
- Creates the EngageIQ merchant account and links it to the Shopify store.
- Requests only the minimum required permissions (principle of least privilege).
- Appears in the Shopify Admin sidebar for quick access.

---

### 9.2 Courier Integrations (Pakistan-Specific)

Direct integrations with Pakistani courier companies to pull delivery data into customer profiles.

**Integrated couriers:**
- **PostEx** — Real-time delivery status, COD collection confirmation
- **Leopards Courier** — Tracking, delivery confirmation, return data
- **TCS Couriers** — Tracking and status
- **M&P (Mubashir and Partners)** — Tracking and delivery

**Data pulled:**
- Delivery attempted / delivered / returned / undeliverable status
- COD amount collected confirmation
- Return reason codes

**How it's used:**
When a delivery is confirmed, EngageIQ triggers the post-purchase automation flow. When a delivery is returned, EngageIQ triggers the return flow and updates the customer's COD acceptance rate in their profile.

---

### 9.3 REST API & Webhooks (Outbound)

EngageIQ exposes its own API and webhook system so merchants can build custom integrations.

**API capabilities:**
- Read customer profiles and segment memberships
- Trigger campaigns programmatically
- Push custom events (as described in 4.5)
- Pull analytics data for external dashboards
- Manage segments via API

**Outbound webhooks:**
Merchants can configure EngageIQ to POST to their own endpoints when events occur:
- Customer enters / exits a segment
- Campaign completes sending
- COD verification result returned
- Churn score crosses a threshold

This allows integration with external CRMs, ERP systems, call center software, and custom internal tools.

---

### 9.4 Role-Based Access Control

**Roles:**

| Role | Access |
|---|---|
| Owner | Full access, billing, API keys, account deletion |
| Admin | All features except billing and account deletion |
| Marketer | Campaigns, flows, segments, analytics. No API access. |
| Analyst | Read-only access to all analytics and segments |
| Agency Admin | Access to all child merchant accounts |
| Agency Member | Access to assigned child merchant accounts only |

**Agency accounts:**
Digital marketing agencies get a parent account that can manage multiple client (child) accounts. They can switch between client dashboards, run reports across clients, and create white-label exports.

---

## 10. Unique Features — South Asia First

These are the features that no competitor offers and that define EngageIQ's market position.

### 10.1 WhatsApp as Primary Channel

WhatsApp is treated as the most important channel in the platform — not a secondary integration. It has dedicated analytics, a dedicated template management interface, its own journey triggers, two-way conversation handling, and is the default first channel in all pre-built flows. No other e-commerce engagement platform is built this way.

### 10.2 COD Intelligence Stack

The entire COD lifecycle is modeled:
- COD order detection and flagging
- Automated verification (WhatsApp / SMS / IVR)
- Fake order scoring (ML model)
- Courier integration for acceptance data
- COD analytics dashboard
- COD-to-prepaid conversion campaigns
- Post-rejection recovery flows

This is a complete product within a product. No Western platform has any of this.

### 10.3 Urdu-First Campaign Support

- Urdu text input with RTL rendering in email builder
- Urdu WhatsApp template creation and submission
- Bilingual A/B testing (same campaign, one variant in Urdu, one in English — measure which performs better)
- Urdu AI copywriter
- Customer language preference stored in profile (segment by language preference)

### 10.4 Multi-Store Cross-Brand Intelligence

- Connect unlimited Shopify stores to one account
- Unified customer profiles across stores (email/phone matching)
- Cross-store revenue analytics
- Cross-store segment builder conditions
- Cross-store campaign targeting
- Group-level LTV and cohort analysis

### 10.5 SKU-Level Retention Analytics

Every product is scored on:
- Repurchase rate
- Cross-sell propensity
- LTV of buyers
- Return rate

Merchants can see a ranked list of their products by "retention value" — not just raw revenue. This drives smarter inventory, marketing, and product development decisions.

### 10.6 AI Models Tuned for South Asian Commerce

RFM thresholds, LTV models, churn scores, and product recommendations are calibrated for:
- PKR-denominated order values
- Eid and Ramadan seasonal spikes
- Local product categories (ethnic wear, food, beauty)
- COD order dynamics
- Local repurchase cycle patterns

Generic models built on Western data systematically under-perform on South Asian stores.

---

## 11. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Backend API | Node.js (Fastify) | Fast, low overhead, great async performance |
| Job Queue | BullMQ + Redis | Reliable queuing, retry logic, rate limiting |
| Primary Database | PostgreSQL | Customer profiles, segments, campaigns, config |
| Analytics Database | ClickHouse | High-speed event queries, columnar, scales to billions of events |
| Cache | Redis | Session data, real-time counters, segment cache |
| Frontend | Remix (React) | SSR, Shopify App compatibility, fast |
| Shopify Integration | Shopify Admin API + Webhooks | Official API, full data access |
| Email Sending | AWS SES | High deliverability, cost-effective at scale |
| WhatsApp | Meta Cloud API (WhatsApp Business API) | Official, no third-party dependency |
| SMS | Twilio + local PK aggregator | Global + local fallback |
| Push Notifications | Web Push Protocol (self-hosted) | No third-party dependency |
| AI / ML | Python microservice (FastAPI) | scikit-learn for RFM/churn, LLM API for copy |
| LLM | Anthropic Claude API | Best-in-class reasoning, Urdu quality |
| Infrastructure | AWS (ECS + RDS + ElastiCache) or self-hosted on PowerEdge R730xd | Flexible deployment |
| IVR / Voice | Fixerr AI integration | Existing capability for COD verification calls |

---

## 12. Data Models

### Core Tables (PostgreSQL)

```sql
-- Merchants
merchants (id, name, shopify_domain, plan, created_at)

-- Customer Profiles
customers (
  id, merchant_id, shopify_customer_id,
  email, phone, first_name, last_name,
  total_orders, total_spent, avg_order_value,
  first_order_at, last_order_at,
  rfm_r, rfm_f, rfm_m, rfm_segment,
  churn_score, ltv_90d, ltv_180d, ltv_365d,
  cod_order_count, cod_acceptance_rate, cod_fake_score,
  language_preference,
  created_at, updated_at
)

-- Segments
segments (id, merchant_id, name, conditions_json, is_dynamic, member_count, updated_at)
segment_memberships (segment_id, customer_id, entered_at, exited_at)

-- Campaigns
campaigns (id, merchant_id, name, type, status, channel, sent_count, open_count, click_count, revenue_attributed, created_at)

-- Journeys (Automation Flows)
journeys (id, merchant_id, name, trigger_type, trigger_config, status, created_at)
journey_steps (id, journey_id, step_type, config_json, position)
journey_enrollments (id, journey_id, customer_id, current_step, status, enrolled_at)

-- COD Orders
cod_orders (id, merchant_id, shopify_order_id, customer_id, amount, verification_status, fake_score, courier, delivery_status, created_at)
```

### Event Store (ClickHouse)

```sql
-- All behavioral events
events (
  event_id UUID,
  merchant_id UInt32,
  customer_id UInt64,
  anon_id String,
  event_name LowCardinality(String),
  properties JSON,
  session_id String,
  device_type LowCardinality(String),
  city String,
  timestamp DateTime
)
-- Partitioned by toYYYYMM(timestamp)
-- Primary key: (merchant_id, customer_id, timestamp)
```

---

*EngageIQ — Product Feature Guide v1.0*
*Swift Studioz, Lahore, Pakistan*
*Confidential — Internal Use*
