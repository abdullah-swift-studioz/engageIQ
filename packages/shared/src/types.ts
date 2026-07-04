export type MerchantId = string & { readonly __brand: 'MerchantId' }
export type CustomerId = string & { readonly __brand: 'CustomerId' }
export type UserId = string & { readonly __brand: 'UserId' }

export type Role = 'OWNER' | 'ADMIN' | 'MARKETER' | 'ANALYST' | 'AGENCY_ADMIN' | 'AGENCY_MEMBER'

export interface JwtPayload {
  sub: UserId
  merchantId: MerchantId
  role: Role
  iat?: number
  exp?: number
}

export interface ApiResponse<T> {
  data: T
  meta?: {
    page?: number
    pageSize?: number
    total?: number
  }
}

export interface ApiError {
  error: string
  message: string
  statusCode: number
}

export interface ShopifyWebhookJob {
  shop: string
  topic: string
  payload: unknown
  shopifyWebhookId: string
  receivedAt: string
  merchantId: string
}

// ─── Shopify Webhook Payload Types ────────────────────────────────────────────

export interface ShopifyAddress {
  city?: string | null
  province?: string | null
  country_code?: string | null
  zip?: string | null
}

export interface ShopifyCustomerPayload {
  id: number
  email: string | null
  phone: string | null
  first_name: string | null
  last_name: string | null
  default_address?: ShopifyAddress
  tags: string
  accepts_marketing: boolean
  created_at: string
  updated_at: string
}

export interface ShopifyLineItem {
  id: number
  product_id: number | null
  variant_id: number | null
  title: string
  quantity: number
  price: string
  sku: string | null
  vendor: string | null
}

export interface ShopifyOrderPayload {
  id: number
  order_number: number
  name: string
  email: string | null
  phone: string | null
  customer: {
    id: number
    email: string | null
    phone: string | null
    first_name: string | null
    last_name: string | null
    default_address?: ShopifyAddress
    tags?: string
    accepts_marketing?: boolean
  } | null
  total_price: string
  subtotal_price: string
  currency: string
  financial_status: string
  fulfillment_status: string | null
  payment_gateway: string
  gateway: string
  line_items: ShopifyLineItem[]
  shipping_address?: ShopifyAddress
  tags: string
  cancelled_at: string | null
  cancel_reason: string | null
  created_at: string
  updated_at: string
}

export interface ShopifyCheckoutPayload {
  token: string
  email: string | null
  phone: string | null
  total_price: string
  currency: string
  line_items: Array<{
    product_id: number | null
    variant_id: number | null
    title: string
    quantity: number
    price: string
    sku: string | null
  }>
  customer?: {
    id: number
    email?: string | null
    phone?: string | null
  }
  created_at: string
  updated_at: string
}

export interface ShopifyRefundPayload {
  id: number
  order_id: number
  created_at: string
  note: string | null
  refund_line_items: Array<{
    line_item_id: number
    quantity: number
    subtotal: string
  }>
  transactions: Array<{
    id: number
    amount: string
    status: string
    kind: string
  }>
}

export interface ShopifyProductVariant {
  id: number
  title: string
  price: string
  sku: string | null
  inventory_quantity: number
  inventory_item_id: number
}

export interface ShopifyProductPayload {
  id: number
  title: string
  handle: string
  vendor: string | null
  product_type: string | null
  variants: ShopifyProductVariant[]
  images: Array<{ src: string }>
  updated_at: string
}

export interface ShopifyInventoryPayload {
  inventory_item_id: number
  location_id: number
  available: number
  updated_at: string
}

// ─── SDK / Storefront Events ─────────────────────────────────────────────────

export interface SdkEventPayload {
  event_name: string
  anon_id: string
  customer_id?: string | null
  session_id: string
  merchant_id: string
  page_url: string
  properties: Record<string, unknown>
  timestamp: string
}

export interface SdkEventBatch {
  events: SdkEventPayload[]
}

export interface SdkIdentifyPayload {
  merchant_id: string
  anon_id: string
  email?: string
  phone?: string
  shopify_customer_id?: string
}

// ─── Enriched Customer Profile (Milestone 3.1) ───────────────────────────────

export interface CustomerSegmentMembership {
  segmentId: string
  segmentName: string
  enteredAt: string
}

export interface CustomerJourneyEnrollment {
  journeyId: string
  journeyName: string
  status: string
  enrolledAt: string
  currentStepId: string | null
}

export interface CustomerRecentOrder {
  id: string
  shopifyOrderId: string
  orderNumber: string
  totalPrice: string
  financialStatus: string | null
  fulfillmentStatus: string | null
  isCod: boolean
  cancelledAt: string | null
  placedAt: string
}

export interface CustomerRecentCheckout {
  id: string
  totalPrice: string
  lineItems?: unknown
  abandonedAt: string | null
  recoveredAt: string | null
}

export interface CustomerEventStats {
  pageViewCount: number
  addToCartCount: number
  checkoutStartedCount: number
  sessionCount: number
}

export interface EnrichedCustomerProfile {
  // Core identity
  id: string
  merchantId: string
  shopifyCustomerId: string | null
  email: string | null
  phone: string | null
  firstName: string | null
  lastName: string | null
  city: string | null
  province: string | null
  country: string
  languagePreference: string | null
  tags: string[]

  // Shopify aggregates
  totalOrders: number
  totalSpent: string
  avgOrderValue: string
  firstOrderAt: string | null
  lastOrderAt: string | null

  // Behavioral (PostgreSQL fast-path + ClickHouse enrichment)
  lastSeenAt: string | null
  sessionCount: number
  eventStats: CustomerEventStats

  // RFM
  rfmSegment: string | null
  rfmRecencyScore: number | null
  rfmFrequencyScore: number | null
  rfmMonetaryScore: number | null
  rfmScoredAt: string | null

  // AI scores
  churnScore: number | null
  churnRiskLabel: string | null
  churnScoredAt: string | null
  ltv90d: string | null
  ltv180d: string | null
  ltv365d: string | null
  ltvScoredAt: string | null

  // COD profile
  codOrderCount: number
  codAcceptanceRate: number | null
  codRejectionRate: number | null
  fakeOrderScore: number | null
  isBlocked: boolean

  // Channel opt-ins
  isSubscribedEmail: boolean
  isSubscribedSms: boolean
  isSubscribedWhatsapp: boolean

  // Multi-store / identity resolution
  groupCustomerId: string | null
  mergedIntoId: string | null
  mergedAt: string | null
  anonIds: string[]

  // Related data
  segmentMemberships: CustomerSegmentMembership[]
  journeyEnrollments: CustomerJourneyEnrollment[]
  recentOrders: CustomerRecentOrder[]
  recentAbandonedCheckouts: CustomerRecentCheckout[]

  createdAt: string
  updatedAt: string
}

// ─── Backfill Job ─────────────────────────────────────────────────────────────

export interface BackfillJobData {
  merchantId: string
}

export type BackfillStatus =
  | 'pending'
  | 'running_customers'
  | 'running_orders'
  | 'recalculating'
  | 'completed'
  | 'failed'

export interface BackfillProgress {
  status: BackfillStatus
  customersTotal: number
  customersDone: number
  ordersTotal: number
  ordersDone: number
  percentComplete: number
  startedAt: string
  completedAt: string | null
  error: string | null
}

// ─── Identity Resolution (Milestone 3.2) ─────────────────────────────────────

export interface MergeResult {
  canonicalId: string      // the profile that survives
  secondaryId: string      // the profile marked as merged
  mergedAt: string         // ISO timestamp
  mergeReason: string      // e.g. "manual_dashboard_merge", "sdk_login_shopify_id_match"
}

// ─── Custom Events (Milestone 3.3) ───────────────────────────────────────────

export interface CustomEventPayload {
  event_name: string
  customer_id?: string
  anon_id?: string
  properties?: Record<string, unknown>
  timestamp?: string  // ISO 8601; defaults to server time if omitted
}

// ─── Multi-Store Group (Milestone 3.3) ───────────────────────────────────────

export interface GroupMember {
  customerId: string
  merchantId: string
  merchantName: string
  email: string | null
  phone: string | null
  firstName: string | null
  lastName: string | null
  totalOrders: number
  totalSpent: string  // Decimal serialised as string
  createdAt: string
}

// ─── Segment Builder ─────────────────────────────────────────────────────────

export type ConditionOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  | 'in' | 'not_in' | 'contains' | 'not_contains'
  | 'is_true' | 'is_false'
  | 'before' | 'after' | 'within_last_days' | 'more_than_days_ago'
  | 'is_set' | 'is_not_set'
  | 'includes_any' | 'includes_all' | 'includes_none'

export interface SegmentCondition {
  field: string
  operator: ConditionOperator
  value: unknown
}

export interface SegmentGroup {
  match: 'all' | 'any'
  rules: Array<SegmentCondition | SegmentGroup>
}

export const SEGMENT_EVALUATE = 'segment:evaluate' as const

export interface SegmentEvaluateJobPayload {
  segmentId: string
  merchantId: string
}

// ─── Journey Executor ─────────────────────────────────────────────────────────

export const JOURNEY_EXECUTOR = 'journey-executor' as const

export type JourneyTriggerType = 'segment_entered' | 'order_placed' | 'custom_event' | 'scheduled'

export type JourneyExecutorJob =
  | { type: 'enroll_customer'; journeyId: string; customerId: string; merchantId: string }
  | { type: 'execute_step'; enrollmentId: string; stepId: string; merchantId: string }
  | { type: 'scheduled_fire'; journeyId: string; merchantId: string }

export interface ActionStepConfig {
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS' | 'PUSH'
  content: { body: string; subject?: string }
}

export interface ConditionStepConfig {
  field: string
  operator: ConditionOperator
  value: unknown
}

export interface DelayStepConfig {
  duration: number
  unit: 'minutes' | 'hours' | 'days'
}

// ─── Channel Dispatch Contract (Phase 0 freeze — Wave 0 seam for Lanes A & B) ──
//
// The single contract the Channels lane (Lane A) implements and the Campaign lane
// (Lane B) consumes. Frozen here in Wave 0 so both lanes build against the same
// seam before they diverge. Mirrors the approved WhatsApp adapter spec
// (docs/superpowers/specs/2026-06-26-whatsapp-channel-adapter-design.md §4.2).
//
// String-literal unions only — @engageiq/shared stays a dependency-free leaf and
// never imports @prisma/client. The DB layer's `Channel` / `TemplateCategory`
// enums map 1:1 onto these unions (the Channels lane bridges the two).

export type ChannelName = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PUSH'

export type TemplateCategory = 'UTILITY' | 'MARKETING'

export const MESSAGE_DISPATCH = 'message-dispatch' as const

// Enqueued by dispatchChannel(); consumed by the message-dispatch worker (Lane A).
// `content` keeps dispatchChannel's existing (channel, customerId, content, merchantId)
// shape so the journey ACTION caller and its tests are untouched. Campaign sends set
// `campaignId`; journey sends set `journeyEnrollmentId` — both optional, for attribution.
export interface MessageDispatchJob {
  type: 'send'
  channel: ChannelName
  merchantId: string
  customerId: string
  content: { body: string; subject?: string }
  templateId?: string
  journeyEnrollmentId?: string
  campaignId?: string
  // Deterministic link back to the originating CampaignRecipient row so Lane A can stamp
  // CampaignRecipient.messageId when it persists the Message. Without this, a per-recipient
  // resend makes (campaignId, customerId) ambiguous. Set by Lane B campaign sends only.
  campaignRecipientId?: string
  // lane:email — additive optional field. When set (EMAIL channel only), the dispatch
  // worker's EMAIL branch renders this EmailTemplate's blocks per-recipient at send time
  // (dynamic products + conditional-by-segment resolved fresh). Absent for plain-body
  // campaign emails and for all WhatsApp/SMS sends, which ignore it.
  emailTemplateId?: string
  // lane:email — optional A/B variant id (indexes into AbTest.variants Json) so the EMAIL
  // branch can pick the variant's subject/blocks. Set by the email template A/B send path.
  abVariantId?: string
}

// The channel-tagged payload handed to a ChannelAdapter.send(). Each channel owns its
// own variant, so SMS/Email can grow fields later without touching send()'s signature.
export type ChannelSendPayload =
  | {
      channel: 'WHATSAPP'
      toPhone: string
      templateName?: string
      languageCode?: string
      category?: TemplateCategory
      variables?: string[]
      freeFormText?: string
    }
  | { channel: 'SMS'; toPhone: string; body: string }
  | { channel: 'EMAIL'; toEmail: string; subject: string; html: string; text: string }
  // lane:push START — one push notification to ONE browser subscription. The push-send
  // worker / message-dispatch PUSH branch fans out one send() call per active subscription.
  | { channel: 'PUSH'; subscription: WebPushSubscription; notification: PushNotification }
// lane:push END

// lane:push START
// A browser Web Push subscription as produced by PushManager.subscribe() — the endpoint
// (unique per browser+device) plus the two encryption keys. Mirrors the JSON stored in
// PushSubscription.endpoint / PushSubscription.keys.
export interface WebPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

// The rendered notification payload delivered to the service worker's `push` handler.
export interface PushNotification {
  title: string
  body: string
  url?: string
  icon?: string
}
// lane:push END

// Adapters never throw for expected provider errors — they return this typed result.
// `retryable` tells the worker whether to rethrow (BullMQ retry) or fail permanently.
export type ChannelSendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; retryable: boolean; errorCode?: string; errorTitle: string }

export interface ChannelAdapter {
  readonly channel: ChannelName
  send(payload: ChannelSendPayload): Promise<ChannelSendResult>
}

// ─── Churn score scale (Phase 0 freeze — shared so 3 Wave-1 lanes agree) ──────
//
// Customer.churnScore is on a 0–100 scale (Feature Guide §8.1), NOT 0–1. The ML writer
// (Lane D), the segment builder numeric filters (Lane C), and journey threshold triggers
// (Lane E) must all use the same scale and bands, so it is pinned here as one source of
// truth. Band upper bounds map 1:1 onto the existing ChurnRiskLabel enum.
export const CHURN_SCORE = {
  MIN: 0,
  MAX: 100,
  // inclusive upper bound of each ChurnRiskLabel band
  BANDS: { LOW: 25, MEDIUM: 50, HIGH: 75, CRITICAL: 100 },
} as const

// lane:analytics START — Phase 4 Analytics Engine
// Read-only DTOs returned by /api/v1/analytics/* and consumed by apps/web analytics pages.
// (No new tables — analytics reads existing ClickHouse events + Postgres; persists only
// Product.* retention columns, which are this lane's to write.)

// The analytics BullMQ queue name (queue already exists in packages/queue; this lane adds the consumer).
export const ANALYTICS = 'analytics' as const

// Precompute jobs consumed by the analytics worker. Idempotent: each recomputes from source.
export type AnalyticsJob =
  | { type: 'product-analytics'; merchantId: string }

export type AnalyticsPeriodKey = 'today' | '7d' | '30d' | '90d' | 'custom'

// Color-coded KPI status vs target (green good / amber watch / red bad).
export type KpiStatus = 'green' | 'amber' | 'red'

export interface AnalyticsAlert {
  level: KpiStatus
  kind: string
  message: string
}

// ── 4.1 Real-Time Dashboard ──────────────────────────────────────────────────
export interface RealtimeActiveCampaign {
  id: string
  name: string
  status: string
  recipientCount: number
  deliveredCount: number
  revenueAttributed: number
}

export interface RealtimeKpis {
  activeVisitors: number
  revenue: { today: number; yesterday: number; sameDayLastWeek: number }
  orders: { today: number; codToday: number; prepaidToday: number }
  customers: { newToday: number; returningToday: number }
  activeCampaigns: RealtimeActiveCampaign[]
  alerts: AnalyticsAlert[]
  generatedAt: string
}

// ── 4.2 RFM dashboard view (read-only; scores written by the ML lane) ─────────
export interface RfmSegmentSize {
  segment: string
  count: number
  pctOfBase: number
}

export interface RfmTrendPoint {
  date: string
  segment: string
  count: number
}

export interface RfmDashboard {
  totalCustomers: number
  totalScored: number
  segments: RfmSegmentSize[]
  trend: RfmTrendPoint[]
  generatedAt: string
}

// ── 4.3 Funnel Analysis ──────────────────────────────────────────────────────
export interface FunnelStepResult {
  step: string
  count: number
  conversionFromFirst: number // 0–1 relative to the first step
  dropOffFromPrev: number // 0–1 lost vs the previous step
}

export interface FunnelResult {
  steps: FunnelStepResult[]
  totalEntered: number
  overallConversion: number // 0–1 last step / first step
  from: string
  to: string
}

// ── 4.4 Cohort Retention ─────────────────────────────────────────────────────
export type CohortGroupBy = 'first_purchase_month' | 'product_category' | 'acquisition_channel' | 'rfm_segment'

export interface CohortRow {
  cohort: string
  cohortSize: number
  // retention[i] = fraction (0–1) of the cohort active in period i (period 0 = 100%); null = future/no data
  retention: Array<number | null>
}

export interface CohortResult {
  groupBy: CohortGroupBy
  periods: number
  rows: CohortRow[]
  generatedAt: string
}

// ── 4.5 Revenue Attribution ──────────────────────────────────────────────────
export type AttributionModel = 'last_touch' | 'first_touch' | 'linear' | 'time_decay'

export interface ChannelAttribution {
  channel: string
  revenue: number
  orders: number
}

export interface CampaignAttributionRow {
  campaignId: string
  name: string
  channel: string
  revenue: number
  recipientCount: number
  roi: number | null // revenue per recipient (proxy ROI); null when recipientCount = 0
}

export interface AttributionResult {
  model: AttributionModel
  byChannel: ChannelAttribution[]
  byCampaign: CampaignAttributionRow[]
  totalAttributed: number
  from: string
  to: string
}

// ── 4.5 Product-Level Retention ──────────────────────────────────────────────
export interface ProductRetentionRow {
  productId: string
  shopifyProductId: string
  title: string
  repurchaseRate90d: number | null
  crossSellRate: number | null
  returnRate: number | null
  avgBuyerLtv: string | null // Decimal serialized as string
  avgDaysToSecondPurchase: number | null
  retentionValue: number | null // composite ranking score
}

export interface ProductRetentionResult {
  products: ProductRetentionRow[]
  computedAt: string | null
}

// ── 4.5 COD Analytics ────────────────────────────────────────────────────────
export interface CodBreakdownRow {
  key: string // city / courier / category / value-band label
  total: number
  accepted: number
  rejected: number
  acceptanceRate: number // 0–1
}

export interface CodAnalytics {
  totalCodOrders: number
  acceptanceRate: number // 0–1
  rejectionRate: number // 0–1
  fakeOrderRate: number // 0–1 (orders with fakeScore above the high threshold)
  codToPrepaidConversion: number | null // 0–1, null when no COD customers
  avgDaysToCollect: number | null
  netRevenueCod: number
  netRevenuePrepaid: number
  byCity: CodBreakdownRow[]
  byCourier: CodBreakdownRow[]
  byValueBand: CodBreakdownRow[]
  from: string
  to: string
}
// lane:analytics END
// lane:ml START
// ─── ML scoring queue (Lane D) ────────────────────────────────────────────────
// The scoring worker reads tenant-scoped features from Postgres, calls the Python
// ML service, and persists scores (RFM/churn/LTV/fake-order) + recommendations +
// ModelRun audit rows. One job per (task, merchant); `merchantId` omitted means all
// merchants. `task: 'full'` runs the daily bundle (rfm + churn + ltv + fake-order +
// recommendations). Segment discovery (5.3) is weekly and its own task.
export const SCORING = 'scoring' as const

export type ScoringTask =
  | 'rfm'
  | 'churn'
  | 'ltv'
  | 'fake-order'
  | 'recommendations'
  | 'segment-discovery'
  | 'full'

export interface ScoringJob {
  task: ScoringTask
  merchantId?: string // omit = every merchant
}

// A discovered cluster returned by the ML service's segment-discovery endpoint,
// surfaced (not auto-created) so a merchant can one-click promote it to a Segment.
export interface DiscoveredSegment {
  label: string
  size: number
  avgLtv: number
  avgRecencyDays: number
  avgFrequency: number
  avgMonetary: number
  description: string
  recommendedAction: string
  customerIds: string[]
}
// lane:ml END
// lane:campaigns START
// ─── Campaign Engine (roadmap 6.1 — one-time blasts) ─────────────────────────
//
// The campaign-send queue already exists (`campaignSendQueue` in queues.ts). This
// is its job payload. One job per campaign; the campaign-send worker fans out one
// MessageDispatchJob per eligible recipient onto the frozen MESSAGE_DISPATCH queue
// (Lane A's consumer), tagging campaignId + campaignRecipientId for attribution.
// jobId is set to the campaignId at enqueue time so re-enqueue is deduped.
export const CAMPAIGN_SEND = 'campaign-send' as const

export interface CampaignSendJob {
  type: 'send_campaign'
  campaignId: string
  merchantId: string
}
// lane:campaigns END
// freeze-v2 START
// ─── Wave-2 job payloads (schema-freeze-v2) ──────────────────────────────────
// Pure additions for the new Wave-2 async workers — a queue-name const + a payload type per
// worker, matching the existing MessageDispatchJob / ScoringJob / CampaignSendJob pattern.
// String-literal unions only, so @engageiq/shared stays a dependency-free leaf (no @prisma/client).
// The lanes that build these workers register the queues in packages/queue and the workers in
// apps/api/src/worker.ts (append-only). No schema work remains — the tables already exist.

// COD verification worker (roadmap 6.4 / guide 7.4): sends WhatsApp/SMS/IVR verification,
// schedules reminders, and auto-cancels on no-response. One VerificationAttempt row per attempt.
export const COD_VERIFICATION = 'cod-verification' as const

export type VerificationChannelName = 'WHATSAPP' | 'SMS' | 'IVR'

export type VerificationJob =
  | { type: 'start'; merchantId: string; codOrderId: string; channel: VerificationChannelName }
  | { type: 'reminder'; merchantId: string; codOrderId: string; attemptNumber: number }
  | { type: 'timeout'; merchantId: string; codOrderId: string }

// Web Push send worker: renders + delivers a Web Push notification to a customer's active
// PushSubscription rows. Omit pushSubscriptionId to fan out to all of the customer's active subs.
export const PUSH_SEND = 'push-send' as const

export interface PushSendJob {
  type: 'send'
  merchantId: string
  customerId: string
  title: string
  body: string
  url?: string
  icon?: string
  pushSubscriptionId?: string
}

// Courier tracking poll worker (roadmap 8.1 / guide 9.2): polls a courier for one shipment's
// latest status, appends CourierEvent rows, and advances CourierShipment.status.
export const COURIER_POLL = 'courier-poll' as const

export type CourierName = 'POSTEX' | 'LEOPARDS' | 'TCS' | 'MP' | 'OTHER'

export interface CourierPollJob {
  type: 'poll'
  merchantId: string
  shipmentId: string
  courier: CourierName
}

// Outbound webhook delivery worker (roadmap 8.2 / guide 9.3): POSTs an event payload to a
// merchant's OutboundWebhook endpoint with HMAC signing + retry/backoff. deliveryId is set on retries.
export const WEBHOOK_DELIVERY = 'webhook-delivery' as const

export interface WebhookDeliveryJob {
  type: 'deliver'
  merchantId: string
  webhookId: string
  event: string
  payload: unknown
  deliveryId?: string
}
// freeze-v2 END

// lane:copywriter START
// AI Copywriter (roadmap 7.4 / feature-guide §8.3): generate marketing copy variants via the
// Anthropic Claude API for email subject lines, WhatsApp text, and SMS — given goal / segment /
// offer / tone / language (English + Urdu). Plus a heuristic subject-line open-rate predictor.
// These are HTTP request/response DTOs (synchronous endpoint, no queue). String-literal unions
// only — @engageiq/shared stays a dependency-free leaf.

export type CopyPurpose = 'email_subject' | 'whatsapp_body' | 'sms_copy'
export type CopyTone = 'formal' | 'casual' | 'urgent' | 'friendly'
export type CopyLanguage = 'en' | 'ur'

// The context a merchant provides in the "Generate with AI" panel.
export interface AiCopyContext {
  goal: string // e.g. "cart recovery", "win-back", "promotion"
  segment?: string // target segment name/description, e.g. "VIP customers", "At-Risk"
  offer?: string // optional offer detail, e.g. "15% off, code SAVE15"
  tone: CopyTone
  language: CopyLanguage
  brandVoice?: string // optional merchant brand-voice note
  productName?: string // optional product/store name to reference
}

export interface AiGenerateRequestDto {
  purpose: CopyPurpose
  channel?: ChannelName // target channel if applicable (email_subject → EMAIL, etc.)
  context: AiCopyContext
  count?: number // number of variants to produce (default 3, max 5)
}

export interface AiCopyVariant {
  text: string // the generated copy
  rationale?: string // one-line reason this variant fits the goal/tone (model-provided)
}

export interface AiGenerationUsage {
  promptTokens: number
  completionTokens: number
  costUsd: number
}

export interface AiGenerateResultDto {
  generationId: string // AiGeneration row id (audit + cost trail)
  purpose: CopyPurpose
  language: CopyLanguage
  model: string
  variants: AiCopyVariant[]
  usage: AiGenerationUsage
}

// Subject-line open-rate predictor: heuristic blend of the merchant's historical email
// open rate and subject-line features. Transparent (not ML) and self-contained.
export interface SubjectPredictRequestDto {
  subject: string
  segment?: string
}

export type SubjectFactorImpact = 'positive' | 'negative' | 'neutral'

export interface SubjectPredictFactor {
  label: string
  impact: SubjectFactorImpact
  detail: string
}

export interface SubjectPredictResultDto {
  subject: string
  predictedOpenRate: number // 0..1
  confidence: 'low' | 'medium' | 'high'
  merchantBaselineOpenRate: number | null // 0..1, null when no email history
  sampleSize: number // # of historical email campaigns informing the baseline
  factors: SubjectPredictFactor[]
}
// lane:copywriter END
// lane:courier START
// ─── Courier poll queue jobs (roadmap 8.1 / guide 9.2) ───────────────────────
// Both job shapes ride the single `courier-poll` queue (COURIER_POLL, frozen in freeze-v2).
// CourierPollJob (freeze-v2) polls ONE shipment. CourierSweepJob fans a merchant's active
// (non-terminal) shipments out into individual poll jobs — enqueued by the repeatable
// scheduler and the manual POST /couriers/sync route. The worker handles the CourierJob union.
export interface CourierSweepJob {
  type: 'sweep'
  // Omit merchantId to sweep every merchant (the scheduled global run). Set it for a
  // single-merchant sweep (the manual sync route).
  merchantId?: string
}

export type CourierJob = CourierPollJob | CourierSweepJob
// lane:courier END
// lane:onsite START
// ─── On-Site Personalization (roadmap 6.5 / guide 7.5) ────────────────────────
// The contract shared between the API delivery endpoint, the storefront SDK
// renderer, and the merchant config UI. It also shapes the two Json columns on
// the frozen `OnSiteElement` model: `config` (OnSiteElementConfig) and
// `displayRules` (OnSiteDisplayRules), plus the `variants` Json on `AbTest`.

export type OnSiteElementTypeName = 'POPUP' | 'STICKY_BAR' | 'EMBED'

// Lifecycle status stored as a String on OnSiteElement (not an enum in the schema).
export type OnSiteElementStatusName = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'

// How an element is triggered on the storefront. The SDK enforces the timing of
// these client-side; the delivery endpoint only decides *eligibility*.
export type OnSiteTriggerType =
  | 'new_visitor' // first-ever session for this browser
  | 'exit_intent' // desktop cursor leaves toward the tab/close bar
  | 'timed' // after N seconds on the page
  | 'cart_value' // when the cart subtotal crosses a threshold
  | 'product_view_restock' // on a product page the visitor previously viewed

// Re-show gating, enforced client-side (localStorage / sessionStorage).
export type OnSiteFrequency = 'always' | 'once_per_session' | 'once_per_day' | 'once_ever'

// Placement of a popup / sticky bar.
export type OnSitePosition =
  | 'center'
  | 'top'
  | 'bottom'
  | 'bottom_left'
  | 'bottom_right'

// The `displayRules` Json column: the trigger + its optional params + gating.
export interface OnSiteDisplayRules {
  trigger: OnSiteTriggerType
  timedDelaySeconds?: number // trigger = 'timed'
  cartValueThreshold?: number // trigger = 'cart_value' (PKR)
  pagePattern?: string // only fire where location.pathname includes this substring
  frequency?: OnSiteFrequency // default 'once_per_session'
}

// The `config` Json column: content + appearance. Subtype fields are optional.
// Headline/body may contain personalization tokens like {{customer.first_name}}.
export interface OnSiteElementConfig {
  headline?: string
  body?: string
  ctaText?: string
  ctaUrl?: string
  captureEmail?: boolean // email-capture popups
  incentiveCode?: string // discount code revealed / applied on the CTA
  position?: OnSitePosition
  imageUrl?: string
  dismissible?: boolean
  embedSelector?: string // EMBED only: CSS selector to inject the block into
}

// One A/B variant — mirrors an entry in the `AbTest.variants` Json array.
export interface OnSiteVariant {
  id: string
  name: string
  config: OnSiteElementConfig
  allocationPct: number // 0..100; the variants of a test sum to 100
}

// ── Delivery contract (public endpoint → SDK) ──
// The SDK POSTs visitor context; the endpoint returns the elements to render,
// with any A/B variant already resolved deterministically for this visitor.

export interface OnSiteDeliveryRequest {
  merchantId: string
  anonId: string
  customerId?: string | null
  pagePath?: string
  cartValue?: number
  viewedProductIds?: string[] // for 'product_view_restock' eligibility
}

export interface OnSiteDeliveryElement {
  id: string // OnSiteElement id
  type: OnSiteElementTypeName
  config: OnSiteElementConfig // resolved config (the assigned variant's, under A/B)
  displayRules: OnSiteDisplayRules
  abTestId?: string // set when the element is under a running/decided A/B test
  variantId?: string // the assigned variant id (echoed onto impression/conversion events)
}

export interface OnSiteDeliveryResponse {
  elements: OnSiteDeliveryElement[]
}

// ClickHouse event types the SDK emits for on-site elements. They flow through
// the existing /v1/sdk/events pipeline (no parallel ingestion path) and carry
// { element_id, variant_id?, ab_test_id?, element_type } in `properties`.
export const ONSITE_IMPRESSION_EVENT = 'onsite_impression' as const
export const ONSITE_CONVERSION_EVENT = 'onsite_conversion' as const
// lane:onsite END
// lane:email START
// ─── Email builder block schema (roadmap 6.4 / guide 7.3) ─────────────────────
//
// The drag-drop email builder stores its section structure as EmailTemplate.blocks
// (Json). Both the API render engine (apps/api/src/services/email/render.ts) and the
// Remix builder (apps/web/app/components/email/*) code against this union, so the
// stored shape is a single source of truth. String-literal unions only — @engageiq/shared
// stays a dependency-free leaf.

export type EmailBlockAlign = 'left' | 'center' | 'right'

// Where a dynamic product block pulls its live products from at render time.
//   top_sellers  — merchant's best-selling products (analytics-ranked)
//   recommended  — per-customer recommendations (ML Recommendation cache)
//   viewed       — products the customer recently viewed (falls back to top_sellers)
//   manual       — an explicit, merchant-picked productIds list
export type EmailProductSource = 'top_sellers' | 'recommended' | 'viewed' | 'manual'

export interface EmailTextBlock {
  id: string
  type: 'text'
  // Sanitized rich-text HTML (may contain {{token}} personalization placeholders).
  html: string
  align?: EmailBlockAlign
}

export interface EmailImageBlock {
  id: string
  type: 'image'
  src: string
  alt?: string
  href?: string
  // Max render width in px (images are capped to the 600px email body width).
  width?: number
  align?: EmailBlockAlign
}

export interface EmailButtonBlock {
  id: string
  type: 'button'
  text: string
  href: string
  align?: EmailBlockAlign
}

export interface EmailDividerBlock {
  id: string
  type: 'divider'
}

export interface EmailSpacerBlock {
  id: string
  type: 'spacer'
  // Vertical space in px.
  height: number
}

export interface EmailDynamicProductBlock {
  id: string
  type: 'dynamic-product'
  source: EmailProductSource
  // How many products to render (1–12).
  limit: number
  // Grid columns (1–4); defaults to a sensible value in the renderer.
  columns?: number
  heading?: string
  // Only for source === 'manual': the explicit product ids to render.
  productIds?: string[]
}

// Conditional-by-segment block: its child blocks render only when the recipient is a
// member of `segmentId`. One template, personalized by segment (guide 7.3).
export interface EmailConditionalBlock {
  id: string
  type: 'conditional'
  segmentId: string
  // Human label for the builder (e.g. "Champions only"); not rendered.
  label?: string
  blocks: EmailBlock[]
}

export type EmailBlock =
  | EmailTextBlock
  | EmailImageBlock
  | EmailButtonBlock
  | EmailDividerBlock
  | EmailSpacerBlock
  | EmailDynamicProductBlock
  | EmailConditionalBlock

// A product resolved for a dynamic-product block at render time. Sourced from the
// Postgres Product table (never ClickHouse — this is catalog data).
export interface EmailRenderProduct {
  id: string
  title: string
  handle?: string | null
  imageUrl?: string | null
  price?: string | null // formatted, e.g. "PKR 2,499"
  url?: string | null // storefront product URL
}

// Everything the render engine needs to turn blocks → a personalized HTML email for one
// recipient. Assembled per-recipient in apps/api (dynamic products + segment membership
// resolved fresh at send time). Kept as loose records so shared imports no Prisma types.
export interface EmailRenderContext {
  customer: Record<string, unknown>
  merchant: Record<string, unknown>
  order?: Record<string, unknown>
  // Segment ids the recipient currently belongs to — drives conditional blocks.
  segmentIds: string[]
  // Resolved product lists keyed by dynamic-product block id.
  productsByBlockId: Record<string, EmailRenderProduct[]>
  // Absolute unsubscribe + open-tracking URLs the renderer injects.
  unsubscribeUrl?: string
  openTrackingUrl?: string
}
// lane:email END
// lane:wa-conversation START
// ─── Two-way WhatsApp conversation engine (roadmap 6.3-6.4 / guide 7.2, 10.1) ──
// The inbound-reply engine that matches non-STOP WhatsApp messages to an OPEN conversation
// (WhatsAppConversation, frozen in schema-freeze-v2) and routes them to the waiting context.
// String-literal unions only — @engageiq/shared stays a dependency-free leaf; the DB
// WhatsAppConversationState enum (OPEN/AWAITING_REPLY/CLOSED/EXPIRED) is used via @prisma/client
// in the api layer, never imported here.

// Stored on WhatsAppConversation.contextType (DB String — the taxonomy grows). "freeform" is an
// inbound message with no structured wait; "journey_reply" resolves a journey wait-for-reply
// branch; "verification" is handed off to the COD verify lane.
export type ConversationContextType = 'journey_reply' | 'verification' | 'freeform'

// One reply branch of a journey "wait for reply" step: an inbound whose normalized text matches
// any keyword routes to the child JourneyStep whose `label` equals `label` — the same
// child-by-label pattern the CONDITION step uses for its 'true' / 'false' children.
export interface JourneyReplyBranch {
  label: string
  keywords: string[]
}

// The "wait for reply / branch on reply" behaviour attached to a journey step. Modeled inside an
// ACTION step's Json `config` because the frozen JourneyStepType enum cannot grow. `timeoutMinutes`
// bounds the awaiting-reply window; `fallbackLabel` is the child used when a reply matches no
// branch, `timeoutLabel` the child used when the timeout fires (both optional — absent = complete).
export interface WaitForReplyConfig {
  timeoutMinutes: number
  branches: JourneyReplyBranch[]
  fallbackLabel?: string
  timeoutLabel?: string
}

// A journey ACTION step's Json config that also carries a waitForReply block IS a wait-for-reply
// step. The executor sends `content` on `channel` (WhatsApp only, for now), opens a journey_reply
// conversation, and parks the enrollment until a matching reply or the timeout resumes it.
export interface WaitForReplyStepConfig {
  channel: 'WHATSAPP'
  content: { body: string }
  waitForReply: WaitForReplyConfig
}

// Delayed timeout job — one per await round, enqueued with { delay } onto the conversation-timeout
// queue (BullMQ-idiomatic, exactly like the DELAY step). Idempotent via a jobId keyed on
// (conversationId, awaitingReplyUntilMs); a no-op if the reply arrived first or the wait re-armed.
export const CONVERSATION_TIMEOUT = 'conversation-timeout' as const

export interface ConversationTimeoutJob {
  type: 'timeout'
  conversationId: string
  awaitingReplyUntilMs: number
}
// lane:wa-conversation END
// lane:rbac START
// ── RBAC + Agency accounts (roadmap 8.3 / guide §9.4) ────────────────────────

// Header an agency user sends to act on one of their child (client) merchants.
// The global acting-merchant preHandler verifies access and swaps the effective
// tenant (request.user.merchantId) to this value for the duration of the request.
export const ACTING_MERCHANT_HEADER = 'x-acting-merchant-id' as const

// One merchant an agency user can operate on ("switch into") or report across.
export interface AccessibleMerchant {
  id: string
  name: string
  shopifyDomain: string | null
  isActive: boolean
  // true when this is the agency user's own home merchant (the agency container itself)
  isHome: boolean
}

// The resolved agency context returned to the dashboard so the switcher can render.
export interface AgencyContext {
  isAgency: boolean
  homeMerchantId: string
  activeMerchantId: string
  accessibleMerchants: AccessibleMerchant[]
}

// A dashboard user row for the Settings → Team screen.
export interface TeamMember {
  id: string
  email: string
  firstName: string
  lastName: string
  role: Role
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface CreateTeamMemberInput {
  email: string
  firstName: string
  lastName: string
  role: Role
  password: string
}

export interface UpdateTeamMemberInput {
  role?: Role
  isActive?: boolean
  firstName?: string
  lastName?: string
}

// One agency member ⇄ child-merchant assignment (which clients a member may access).
export interface AgencyAssignmentView {
  id: string
  userId: string
  childMerchantId: string
  childMerchantName: string
  createdAt: string
}

// A single client's headline numbers in the agency cross-client report.
export interface AgencyClientReportRow {
  merchantId: string
  merchantName: string
  customerCount: number
  totalRevenue: string
  orderCount: number
}

export interface AgencyClientReport {
  generatedAt: string
  clientCount: number
  rows: AgencyClientReportRow[]
}
// lane:rbac END

// lane:flows START — Pre-Built Flow Library (guide §7.6)
//
// A FlowTemplate is a system-owned (not merchant-scoped) blueprint for a journey. Its
// `graphJson` carries a trigger definition plus a flat node list that mirrors the visual
// builder's GraphNode shape (apps/api/src/routes/journeys/schema.ts). "Use this flow"
// creates a DRAFT Journey from `trigger` and deep-copies `nodes` into journey_steps via the
// existing saveJourneyGraph path — so every instantiated flow is immediately runnable by the
// live journey executor and editable in the existing builder, with zero engine changes.

export type FlowCategory =
  | 'abandoned_cart'
  | 'welcome'
  | 'post_purchase'
  | 'win_back'
  | 'loyalty_vip'
  | 'cod'

export const FLOW_CATEGORIES: readonly FlowCategory[] = [
  'abandoned_cart',
  'welcome',
  'post_purchase',
  'win_back',
  'loyalty_vip',
  'cod',
] as const

// One node in a FlowTemplate graph. Identical in shape to the builder's GraphNode so the
// graph round-trips into the self-referential journey_steps tree on instantiation.
export interface FlowTemplateNode {
  tempId: string
  stepType: 'TRIGGER' | 'ACTION' | 'CONDITION' | 'DELAY' | 'AB_SPLIT'
  label: string | null
  config: Record<string, unknown>
  positionX: number
  positionY: number
  parentTempId: string | null
}

// Journey-level trigger definition (lives on the Journey row, not a step).
export interface FlowTemplateTrigger {
  triggerType: JourneyTriggerType
  triggerConfig: Record<string, unknown>
  reEntryRule: 'ALLOW' | 'DISALLOW' | 'RE_ENROLL_AFTER_EXIT'
  exitTrigger: 'order_placed' | 'segment_entered' | 'custom_event' | null
}

export interface FlowTemplateGraph {
  trigger: FlowTemplateTrigger
  nodes: FlowTemplateNode[]
}

// API DTO for a template in the browse list / preview (system table, safe to expose as-is).
export interface FlowTemplateDTO {
  key: string
  name: string
  category: FlowCategory
  description: string
  channels: ChannelName[]
  icon: string | null
  graph: FlowTemplateGraph
}

// Result of instantiating a template into a real merchant Journey.
export interface FlowInstantiationResult {
  journeyId: string
  name: string
  sourceFlowTemplateKey: string
  stepCount: number
}
// lane:flows END
