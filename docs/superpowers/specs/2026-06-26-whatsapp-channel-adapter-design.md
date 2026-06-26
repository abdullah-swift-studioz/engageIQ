# WhatsApp Channel Adapter — Design Spec

**Date:** 2026-06-26
**Phase / Milestone:** Campaign Execution & Channel Integration — WhatsApp Cloud send (maps to roadmap 6.3, WhatsApp half)
**Status:** Approved design, pending spec review
**Author:** Claude Code (Session)

---

## 1. Goal & Scope

Replace the `dispatchChannel` stub with a real, production-usable **WhatsApp Cloud API** send path, behind a channel-agnostic `ChannelAdapter` interface that SMS and Email plug into later.

### In scope

- Outbound WhatsApp send via **Meta-approved templates** (business-initiated).
- Outbound **free-form text** inside the 24-hour customer-service window.
- **Delivery / read / failed status** webhooks, persisted with monotonic status advancement.
- **Opt-out**: inbound `STOP`/`UNSUBSCRIBE` text matching **and** Meta's native marketing opt-out signal.
- **Per-merchant rate limiting** (Redis token bucket, jittered re-enqueue).
- **Template CRUD + Meta submit-for-approval** with approval-status tracking.
- **Urdu RTL preview** in the template editor.
- Read-only **message log / analytics** view over `Message` rows.

### Explicitly out of scope (deferred, not precluded)

- SMS (Twilio + PK aggregator) and Email (SES) sends — remain stubs behind `ChannelAdapter`.
- Two-way conversation → journey "wait for reply" branch — journey-engine extension, later milestone.
- `AUTHENTICATION` template category.
- Transactional outbox, separate suppression table, RFM/funnel/cohort analytics in the message view.

---

## 2. Architecture (Approach A — async send queue + ChannelAdapter)

```
Journey ACTION step / (future) Campaign send
        │
        ▼
dispatchChannel(channel, customerId, content, merchantId)   ← thin enqueue (signature unchanged)
        │  enqueue MessageDispatchJob
        ▼
[ message-dispatch queue ] ──► message-dispatch.worker
                                   │ 1. load customer (merchant-scoped)
                                   │ 2. consent gate (isSubscribedWhatsapp)
                                   │ 3. per-merchant rate-limit (Redis bucket)
                                   │ 4. resolve template + substitute variables
                                   │ 5. adapter.send(payload)  ──► WhatsAppAdapter ──► Meta Cloud API
                                   │ 6. persist Message (SENT + wamid | FAILED + error)
                                   ▼
                          PostgreSQL: messages, whatsapp_templates

Meta ──► POST /webhooks/whatsapp (status + inbound)
            │  HMAC verify (META_APP_SECRET)
            │  status update (MONOTONIC) by wamid
            │  inbound STOP / native opt-out → isSubscribedWhatsapp=false + log inbound Message
            ▼
        PostgreSQL: messages, customers
```

**Why Approach A:** sends get independent retries / DLQ / rate-limiting; a slow Meta call never consumes journey-worker concurrency; `ChannelAdapter` is the single seam for SMS/Email. (Approach B — synchronous send inside `dispatchChannel` — was rejected: send failure would retry the whole journey step, no per-merchant limit, Meta latency blocks the journey worker. Approach C — transactional outbox + poller — was rejected as redundant given BullMQ's durable retries.)

This mirrors the existing patterns exactly: queue defined in `packages/queue`, worker in `apps/api/src/workers`, route module in `apps/api/src/routes/<name>/{index,controller,service,schema}.ts`, all queries `merchantId`-scoped.

---

## 3. Data Model (Prisma — new models + migration)

### 3.1 `WhatsAppTemplate`

| Field | Type | Notes |
|---|---|---|
| `id` | String cuid | PK |
| `merchantId` | String | tenant scope (FK → Merchant, onDelete: Cascade) |
| `name` | String | Meta template name (lowercase/underscore) |
| `language` | **String** | **Meta language code, e.g. `en`, `en_US`, `ur`, `ar`, `ar_AE`. NOT an enum.** |
| `category` | `TemplateCategory` | `UTILITY` \| `MARKETING` (no `AUTHENTICATION`) |
| `bodyText` | String | template body with `{{1}}`, `{{2}}` … placeholders |
| `variableMap` | Json | ordered list; see 3.3 |
| `status` | `TemplateStatus` | `DRAFT` \| `PENDING` \| `APPROVED` \| `REJECTED` |
| `metaTemplateId` | String? | Meta-assigned id after submit |
| `rejectionReason` | String? | populated on `REJECTED` |
| `createdAt` / `updatedAt` | DateTime | |

Constraints: `@@unique([merchantId, name, language])`, `@@index([merchantId])`.

**Language decision (per change #1):** stored as a free string holding Meta's language code, including regional variants (`en_US`, `ar_AE`). A two-value `'en'|'ur'` enum is rejected because EngageIQ targets MENA (Arabic in scope) and Meta's language set is a specific, evolving code list — a constrained enum would force a migration the first time a merchant needs a locale variant. Validation of the string is a Zod `min(1)` plus a soft allow-list check in the service layer (warn, do not hard-block unknown codes).

### 3.2 `Message` (outbound + inbound log)

| Field | Type | Notes |
|---|---|---|
| `id` | String cuid | PK |
| `merchantId` | String | tenant scope (FK → Merchant, onDelete: Cascade) |
| `customerId` | String? | FK → Customer (nullable: inbound from unknown number) |
| `channel` | `Channel` | reuse existing enum; `WHATSAPP` here |
| `direction` | `MessageDirection` | `OUTBOUND` \| `INBOUND` |
| `templateId` | String? | FK → WhatsAppTemplate (null for free-form / inbound) |
| `providerMessageId` | String? | Meta `wamid`; `@unique` for status-webhook lookup + idempotency |
| `status` | `MessageStatus` | `QUEUED` \| `SENT` \| `DELIVERED` \| `READ` \| `FAILED` \| `RECEIVED` |
| `errorCode` | String? | Meta error code on FAILED |
| `errorTitle` | String? | Meta error title on FAILED |
| `body` | String | rendered text actually sent / received |
| `toPhone` | String | E.164 |
| `fromPhone` | String? | set for inbound |
| `journeyEnrollmentId` | String? | attribution (nullable) |
| `campaignId` | String? | attribution (nullable, future) |
| `sentAt` / `deliveredAt` / `readAt` / `failedAt` | DateTime? | stamped per matching event |
| `createdAt` | DateTime | |

Indexes: `@@index([merchantId])`, `@@index([providerMessageId])`, `@@index([customerId])`, `@@index([merchantId, channel, direction])`.

> `providerMessageId` is nullable (inbound messages and pre-send rows may lack one) but `@unique`. Postgres treats multiple NULLs as distinct, so the unique constraint does not collide on null — acceptable.

### 3.3 `variableMap` shape (per change #2)

JSON array, one entry per `{{n}}`, **each carrying an optional default**:

```jsonc
[
  { "index": 1, "field": "firstName", "default": "there" },
  { "index": 2, "field": "city",      "default": "your city" },
  { "index": 3, "field": "totalOrders" }            // no default → if it resolves empty, the send FAILS locally (see rule)
]
```

**Substitution rule (dispatch worker):** for each entry, resolve `field` from the customer profile. If the resolved value is `null`, `undefined`, or empty string, substitute `default`. **If no `default` is provided and the field resolves empty, the worker treats the send as a non-retryable failure** (`Message.status=FAILED`, `errorTitle="Empty template variable {{n}}"`, `UnrecoverableError`) rather than letting Meta reject the whole message opaquely. Reason: Meta rejects the entire send when any template variable resolves empty; sparse COD/South-Asia profiles are common, so defaults are the primary defense and an explicit local failure (with a clear reason) is better than a silent Meta rejection.

### 3.4 New enums

```prisma
enum MessageDirection { OUTBOUND INBOUND }
enum MessageStatus    { QUEUED SENT DELIVERED READ FAILED RECEIVED }
enum TemplateStatus   { DRAFT PENDING APPROVED REJECTED }
enum TemplateCategory { UTILITY MARKETING }
```

Opt-out reuses `Customer.isSubscribedWhatsapp` — **no new suppression table**. The inbound `Message` log is the opt-out audit trail. `isSubscribedSms` / `isSubscribedEmail` already exist on `Customer` and are left untouched until those channels arrive.

Migration: `add_whatsapp_messaging` (new models + enums). No changes to existing tables except the back-relations on `Merchant` and `Customer`.

---

## 4. Runtime Components

### 4.1 Queue (`packages/queue`)

- `messageDispatchQueue = new Queue('message-dispatch', { connection, defaultJobOptions })`.
- Add `'message-dispatch'` to the `QueueName` union.
- DLQ behavior via existing `defaultJobOptions` (`attempts: 3`, exponential backoff, `removeOnFail.count`). Permanent failures throw `UnrecoverableError` to skip retries.

### 4.2 Shared types (`packages/shared`)

- `MESSAGE_DISPATCH = 'message-dispatch'` const.
- `MessageDispatchJob` discriminated union (currently one variant; shaped for growth):
  ```ts
  type MessageDispatchJob = {
    type: 'send'
    channel: Channel
    merchantId: string
    customerId: string
    content: { body: string; subject?: string }
    templateId?: string
    journeyEnrollmentId?: string
  }
  ```
- **`ChannelAdapter` send payload as a channel-tagged discriminated union (per change #6):**
  ```ts
  type ChannelSendPayload =
    | { channel: 'WHATSAPP'; toPhone: string; templateName?: string; languageCode?: string;
        category?: TemplateCategory; variables?: string[]; freeFormText?: string }
    | { channel: 'SMS';   toPhone: string; body: string }            // stub
    | { channel: 'EMAIL'; toEmail: string; subject: string; html: string; text: string } // stub

  type ChannelSendResult =
    | { ok: true; providerMessageId: string }
    | { ok: false; retryable: boolean; errorCode?: string; errorTitle: string }

  interface ChannelAdapter {
    readonly channel: Channel
    send(payload: ChannelSendPayload): Promise<ChannelSendResult>
  }
  ```
  SMS/Email can add fields to their own variant later without touching `send()`'s signature.

### 4.3 `dispatchChannel` (`apps/api/src/lib/channels/dispatcher.ts`)

Becomes a thin enqueue onto `message-dispatch`. **Signature unchanged** (`channel, customerId, content, merchantId`) so the journey worker and its tests are untouched. Maps the call to a `MessageDispatchJob` and `.add()`s it.

### 4.4 `WhatsAppAdapter` (`apps/api/src/lib/channels/whatsapp.adapter.ts`)

- Implements `ChannelAdapter` with `channel = 'WHATSAPP'`.
- Native `fetch`, **zero new deps** (same as the Shopify integration).
- **Endpoint selection isolated in one place (per change #7):** a private `resolveEndpoint(category)` returns the URL. Today **all categories** return the standard Cloud API endpoint, built from `env.META_API_VERSION` + `META_WHATSAPP_PHONE_NUMBER_ID`:
  `https://graph.facebook.com/${env.META_API_VERSION}/${phoneNumberId}/messages`.
  A `MARKETING`-category route (Meta MM Lite / `marketing_messages`) can later be returned from this same function without touching the rest of the adapter. **The version is never hardcoded in a URL string** — always `env.META_API_VERSION` (default `v21.0`).
- Builds the Meta payload:
  - **Template** (`templateName` present): `{ messaging_product:'whatsapp', to, type:'template', template:{ name, language:{ code }, components:[{ type:'body', parameters: variables.map(text => ({type:'text', text})) }] } }`.
  - **Free-form** (`freeFormText` present): `{ messaging_product:'whatsapp', to, type:'text', text:{ body } }`.
- Auth: `Authorization: Bearer ${env.META_WHATSAPP_TOKEN}`.
- If `META_WHATSAPP_TOKEN` or `META_WHATSAPP_PHONE_NUMBER_ID` is absent → return `{ ok:false, retryable:false, errorTitle:'WhatsApp not configured' }` (no throw; worker records FAILED). App still boots credential-free.
- Parses `{ messages:[{ id }] }` → `{ ok:true, providerMessageId:id }`. Maps Meta error envelope `{ error:{ code, message } }` → `{ ok:false, retryable: <5xx|429>, errorCode, errorTitle }`.

### 4.5 `message-dispatch.worker.ts` (`apps/api/src/workers`)

Per job:
1. Load `customer` (merchant-scoped). If missing → `UnrecoverableError`.
2. **Consent gate:** if `channel==='WHATSAPP'` and `!customer.isSubscribedWhatsapp` → log + skip (no Message row, return). For non-WhatsApp stub channels → skip with log.
3. **Rate limit (per change #5):** Redis token bucket keyed `ratelimit:wa:{merchantId}` (`INCR` + first-hit `EXPIRE` over a 1s window, cap configurable, default e.g. 80/s placeholder — tunable constant). If over cap → re-enqueue same job with `delay = base + jitter` where `jitter = pseudo-random spread derived from job attempt/id` (avoids synchronized retry at the window boundary), then return.
4. Resolve template (if `templateId`): load `WhatsAppTemplate` (merchant-scoped, must be `APPROVED` for business-initiated send; else `UnrecoverableError` "template not approved"). Build `variables[]` by applying the §3.3 substitution rule (defaults, empty-without-default → FAILED).
5. `adapter.send(payload)`.
6. Persist `Message`: success → `status:SENT`, `providerMessageId`, `sentAt:now`; failure → `status:FAILED`, `errorCode/errorTitle`, `failedAt:now`. Retryable failures throw to let BullMQ retry; non-retryable use `UnrecoverableError`.

Wired into `worker.ts` with `completed`/`failed`/`error` listeners and graceful-shutdown `Promise.all`, identical to the journey-executor worker. Concurrency 10.

### 4.6 Webhook route (`apps/api/src/routes/webhooks/whatsapp.ts`)

- **`GET /webhooks/whatsapp`** — verification handshake: if `hub.mode==='subscribe'` and `hub.verify_token===env.META_WEBHOOK_VERIFY_TOKEN` → return `hub.challenge` (200, text). Else 403.
- **`POST /webhooks/whatsapp`** — opts into `rawBody` (existing `fastify-raw-body` plugin, `config:{ rawBody:true }`). Verify `X-Hub-Signature-256` HMAC-SHA256 of the raw body using **`env.META_APP_SECRET`** (new). Invalid → 401. Always return 200 quickly after enqueue/processing of parsed events (never block Meta).
- **Status events** (`entry[].changes[].value.statuses[]`): look up `Message` by `providerMessageId` (wamid). Apply **monotonic status advancement (per change #3)**:
  - Rank: `QUEUED(0) < SENT(1) < DELIVERED(2) < READ(3)`. `FAILED` is terminal.
  - Only advance `status` forward (`rank(incoming) > rank(current)`); never regress. A `READ` arriving before `DELIVERED` sets `status=READ` and stamps `readAt`; a later `DELIVERED` stamps `deliveredAt` but does **not** move `status` back to `DELIVERED`.
  - Always stamp the matching timestamp (`sentAt`/`deliveredAt`/`readAt`/`failedAt`) whenever its event arrives, regardless of current canonical status.
  - Once `FAILED`, canonical `status` stays `FAILED`. Stamp `failedAt` on the failure event; ignore subsequent non-FAILED status changes for canonical `status` (later timestamps may still be recorded, but `status` does not move off `FAILED`).
- **Inbound messages** (`entry[].changes[].value.messages[]`): log an inbound `Message` (`direction:INBOUND`, `status:RECEIVED`, `fromPhone`, `body`). Match `customer` by phone (merchant-scoped) when possible. **Opt-out (per change #4):**
  - Text path: body matches `STOP`/`UNSUBSCRIBE` (case-insensitive, trimmed) → set `isSubscribedWhatsapp=false`.
  - **Native marketing opt-out path:** detect Meta's button/native opt-out signal in the payload (the "Stop promotions" interactive reply / marketing opt-out marker) → set `isSubscribedWhatsapp=false` on the same customer. Do **not** rely on keyword text alone.
- Registered in `index.ts` at prefix `/webhooks` (public, no `authenticate`; protected by HMAC). Add `META_*` webhook path to any rate-limit allowlist as needed.

### 4.7 Template routes (`apps/api/src/routes/whatsapp-templates/`)

Standard `index/controller/service/schema`, all `merchantId`-scoped, behind `fastify.authenticate`:
- `POST /api/v1/whatsapp-templates` — create (`DRAFT`).
- `GET /api/v1/whatsapp-templates` — paginated list.
- `GET /api/v1/whatsapp-templates/:id` — detail.
- `PUT /api/v1/whatsapp-templates/:id` — update (`DRAFT`/`REJECTED` only).
- `DELETE /api/v1/whatsapp-templates/:id`.
- `POST /api/v1/whatsapp-templates/:id/submit` — submit to Meta. With creds: POST to Meta's `message_templates` Graph endpoint, store `metaTemplateId`, set `status=PENDING`. Without creds: set `status=PENDING` locally (no external call) so the flow is testable offline.

Zod schemas validate `name`, `language` (`min(1)` + soft code check), `category`, `bodyText`, and `variableMap` (array of `{ index:int, field:string, default?:string }`, indices contiguous from 1, count matches `{{n}}` placeholders in `bodyText`).

---

## 5. Frontend (Remix — `apps/web/app/routes`)

- `whatsapp-templates._index.tsx` — list with status badges (DRAFT/PENDING/APPROVED/REJECTED), language code, category; link to detail/new.
- `whatsapp-templates.new.tsx` — editor: name, language code, category, body with `{{n}}` insert, `variableMap` rows (field + optional default). **Urdu/Arabic RTL live preview**: when the language code starts `ur`/`ar` (or contains RTL script), the preview pane renders `dir="rtl"` with sample variable values; LTR otherwise.
- `whatsapp-templates.$id.tsx` — detail + Submit-to-Meta button + approval status / rejection reason; edit form for DRAFT/REJECTED.
- `messages._index.tsx` — **read-only** log over `Message` rows with summary counters: delivery rate, read rate, opt-out count (derived from inbound opt-out Messages / consent flips), failed count. **No RFM/funnel/cohort logic** — that is a later phase.

(Client-side auth in Remix continues to use the existing `DEV_TOKEN` pattern, consistent with segment/journey pages; full auth hardening deferred as before.)

---

## 6. Error Handling

- Adapter returns typed `ChannelSendResult`; never throws for expected Meta errors.
- Worker: transient (`retryable:true` — 5xx/429) → throw to let BullMQ retry (exp backoff, 3 attempts, then DLQ via `removeOnFail`); permanent (template not approved, invalid number, empty-variable-no-default, not configured) → `UnrecoverableError` + `Message.status=FAILED` with code/title.
- Webhook: HMAC-verify first; malformed/unsigned → 401; parsed-event handler is defensive (missing fields skipped, logged) and always 200s so Meta does not back off.
- All service errors follow the standard envelope `{ success:false, error:{ code, message } }`; never leak raw DB errors.

---

## 7. Configuration (env)

Add to `packages/shared/src/env.ts`, `.env`, `.env.example`:
- `META_APP_SECRET` — `z.string().optional()` — used to HMAC-verify inbound webhook payloads. Comment: "Meta App Secret — Meta App Dashboard → Settings → Basic. Required to verify WhatsApp webhook signatures."
- `META_API_VERSION` — `z.string().default('v21.0')` — Graph API version; **never hardcode in a URL string**.

Already present (optional): `META_WHATSAPP_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WEBHOOK_VERIFY_TOKEN`. App boots credential-free; sends fail with a clear "WhatsApp not configured" until real keys are supplied.

---

## 8. Testing (Vitest, ~20 tests)

- **Adapter**: template payload shape; free-form payload shape; wamid parse; error-envelope mapping (retryable vs not); "not configured" path; endpoint built from `META_API_VERSION` (no hardcoded version).
- **Worker**: consent-skip (opted-out → no send, no Message); variable substitution with default; **empty-variable-without-default → FAILED**; success persists SENT+wamid; retryable failure rethrows; rate-limit over-cap re-enqueues with jittered delay.
- **Webhook**: GET challenge echo (valid/invalid token); POST HMAC reject; status update SENT→DELIVERED→READ; **out-of-order READ-before-DELIVERED keeps status=READ, still stamps deliveredAt (explicit test, per change #3)**; FAILED terminal; inbound STOP text → unsubscribe; **native marketing opt-out signal → unsubscribe (per change #4)**.
- **Template service**: CRUD; submit with creds (Meta call mocked) sets PENDING+metaTemplateId; submit without creds sets PENDING locally; variableMap/placeholder count validation.

---

## 9. Files Created / Modified (anticipated)

**Created**
- `packages/db/prisma/migrations/<ts>_add_whatsapp_messaging/`
- `apps/api/src/lib/channels/whatsapp.adapter.ts` (+ `.test.ts`)
- `apps/api/src/lib/channels/channel-adapter.ts` (interface + payload/result types) — or co-located in shared
- `apps/api/src/workers/message-dispatch.worker.ts` (+ `.test.ts`)
- `apps/api/src/routes/webhooks/whatsapp.ts` (+ `.test.ts`)
- `apps/api/src/routes/whatsapp-templates/{index,controller,service,schema}.ts` (+ service `.test.ts`)
- `apps/web/app/routes/whatsapp-templates._index.tsx`, `.new.tsx`, `.$id.tsx`, `messages._index.tsx`

**Modified**
- `packages/db/prisma/schema.prisma` — 2 models, 4 enums, back-relations on Merchant/Customer
- `packages/queue/src/queues.ts` + `QueueName` union — `message-dispatch` queue
- `packages/shared/src/types.ts` + `index.ts` — `MESSAGE_DISPATCH`, `MessageDispatchJob`, `ChannelAdapter`/payload/result types
- `packages/shared/src/env.ts`, `.env`, `.env.example` — `META_APP_SECRET`, `META_API_VERSION`
- `apps/api/src/lib/channels/dispatcher.ts` — enqueue instead of log
- `apps/api/src/worker.ts` — wire message-dispatch worker + shutdown
- `apps/api/src/index.ts` — register webhook + template routes

---

## 10. Decisions Locked

- Approach A (async send queue + ChannelAdapter). B and C rejected (see §2).
- `language` is a string code, not an enum (§3.1).
- `variableMap` entries carry optional defaults; empty-without-default → local FAILED (§3.3).
- Webhook status updates are monotonic by rank, timestamps always stamped (§4.6).
- Opt-out via STOP text **and** native marketing opt-out signal (§4.6).
- Rate limiter re-enqueues with jitter (§4.5).
- `send()` payload is a channel-tagged discriminated union (§4.2).
- Endpoint URL selection isolated for future MARKETING routing (§4.4).
- No outbox, no suppression table, read-only message view, `META_API_VERSION` in env, no `AUTHENTICATION` category.
