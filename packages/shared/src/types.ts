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
