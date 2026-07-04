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
