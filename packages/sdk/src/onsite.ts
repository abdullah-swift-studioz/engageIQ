/**
 * EngageIQ On-Site Personalization renderer.
 *
 * Self-contained (no @engageiq/shared import — the SDK is a standalone IIFE).
 * Fetches the elements eligible for this visitor from the delivery endpoint and
 * renders popups / sticky bars / inline embeds, enforcing each element's trigger
 * (new-visitor / exit-intent / timed / cart-value / product-view-restock) and
 * frequency gating client-side. Impressions and conversions are reported through
 * the SAME event pipeline as everything else (the injected `track` callback →
 * /v1/sdk/events → ClickHouse), never a parallel path.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type TrackFn = (name: string, props: Record<string, unknown>) => void

export interface OnSiteContext {
  apiBase: string
  merchantId: string
  anonId: string
  customerId: string | null
  track: TrackFn
}

type TriggerType = 'new_visitor' | 'exit_intent' | 'timed' | 'cart_value' | 'product_view_restock'
type Frequency = 'always' | 'once_per_session' | 'once_per_day' | 'once_ever'
type Position = 'center' | 'top' | 'bottom' | 'bottom_left' | 'bottom_right'

interface DisplayRules {
  trigger: TriggerType
  timedDelaySeconds?: number
  cartValueThreshold?: number
  pagePattern?: string
  frequency?: Frequency
}

interface ElementConfig {
  headline?: string
  body?: string
  ctaText?: string
  ctaUrl?: string
  captureEmail?: boolean
  incentiveCode?: string
  position?: Position
  imageUrl?: string
  dismissible?: boolean
  embedSelector?: string
}

interface DeliveryElement {
  id: string
  type: 'POPUP' | 'STICKY_BAR' | 'EMBED'
  config: ElementConfig
  displayRules: DisplayRules
  abTestId?: string
  variantId?: string
}

const VIEWED_KEY = '_eiq_vp'
const SEEN_KEY = '_eiq_seen'
const STYLE_ID = '_eiq_os_style'

// ─── Small storage helpers (all wrapped — private mode / iframes throw) ───────

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}
function ssGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}
function ssSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

function isMobile(): boolean {
  return /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent)
}

// ─── Frequency gating ─────────────────────────────────────────────────────────

function freqKey(id: string): string {
  return '_eiq_os_' + id
}

/** True when this element may be shown now under its frequency rule. */
function canShow(el: DeliveryElement): boolean {
  const freq = el.displayRules.frequency ?? 'once_per_session'
  const key = freqKey(el.id)
  if (freq === 'always') return true
  if (freq === 'once_per_session') return !ssGet(key)
  if (freq === 'once_ever') return !lsGet(key)
  if (freq === 'once_per_day') {
    const last = lsGet(key)
    if (!last) return true
    return Date.now() - Number(last) > 864e5 // 24h
  }
  return true
}

/** Record that this element was shown, so the frequency rule holds next time. */
function markShown(el: DeliveryElement): void {
  const freq = el.displayRules.frequency ?? 'once_per_session'
  const key = freqKey(el.id)
  if (freq === 'once_per_session') ssSet(key, '1')
  else if (freq === 'once_ever') lsSet(key, '1')
  else if (freq === 'once_per_day') lsSet(key, String(Date.now()))
}

// ─── Storefront context ───────────────────────────────────────────────────────

function currentProductId(): string | null {
  const meta = (window as any).ShopifyAnalytics?.meta
  return meta?.product?.id ? String(meta.product.id) : null
}

/** Product ids the visitor has viewed in earlier page loads (read before we add the current one). */
function readViewedProducts(): string[] {
  try {
    const raw = lsGet(VIEWED_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function rememberCurrentProduct(): void {
  const pid = currentProductId()
  if (!pid) return
  const list = readViewedProducts()
  if (!list.includes(pid)) {
    list.push(pid)
    // Cap the history so localStorage never grows unbounded.
    lsSet(VIEWED_KEY, JSON.stringify(list.slice(-100)))
  }
}

/** Best-effort cart subtotal in major units (PKR), via Shopify's Ajax cart. */
async function fetchCartValue(): Promise<number> {
  try {
    const res = await fetch('/cart.js', { headers: { Accept: 'application/json' } })
    if (!res.ok) return 0
    const cart = (await res.json()) as { total_price?: number }
    return typeof cart.total_price === 'number' ? cart.total_price / 100 : 0
  } catch {
    return 0
  }
}

// ─── Personalization tokens ───────────────────────────────────────────────────

function personalize(text: string | undefined): string {
  if (!text) return ''
  const cust = (window as any).Shopify?.customer
  const firstName = cust?.first_name ?? cust?.firstName ?? ''
  return text
    .replace(/\{\{\s*customer\.first_?name\s*\}\}/gi, String(firstName))
    // Any remaining unknown token is stripped rather than shown raw.
    .replace(/\{\{[^}]*\}\}/g, '')
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = [
    '.eiq-os-overlay{position:fixed;inset:0;background:rgba(10,10,10,.55);z-index:2147483000;display:flex;padding:16px}',
    '.eiq-os-card{background:#fff;color:#0a0a0a;max-width:420px;width:100%;margin:auto;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.28);padding:24px;position:relative;font-family:Inter,system-ui,sans-serif}',
    '.eiq-os-bar{position:fixed;left:0;right:0;z-index:2147483000;background:#0a0a0a;color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:center;gap:12px;font-family:Inter,system-ui,sans-serif;font-size:14px}',
    '.eiq-os-embed{border:1px solid #e5e5e5;border-radius:8px;padding:16px;font-family:Inter,system-ui,sans-serif;margin:12px 0}',
    '.eiq-os-cta{display:inline-block;background:#0a0a0a;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none}',
    '.eiq-os-bar .eiq-os-cta{background:#fff;color:#0a0a0a;padding:6px 12px}',
    '.eiq-os-x{position:absolute;top:10px;right:12px;background:none;border:0;font-size:20px;line-height:1;cursor:pointer;color:#737373}',
    '.eiq-os-bar-x{background:none;border:0;color:#fff;font-size:18px;cursor:pointer;line-height:1}',
    '.eiq-os-h{font-size:20px;font-weight:700;margin:0 0 8px;letter-spacing:-.01em}',
    '.eiq-os-b{font-size:14px;color:#404040;margin:0 0 16px;line-height:1.5}',
    '.eiq-os-img{max-width:100%;border-radius:8px;margin-bottom:12px}',
    '.eiq-os-input{width:100%;box-sizing:border-box;border:1px solid #d4d4d4;border-radius:6px;padding:10px 12px;font-size:14px;margin-bottom:12px}',
    '.eiq-os-code{display:inline-block;font-weight:700;border:1px dashed #0a0a0a;border-radius:6px;padding:6px 10px;margin-top:8px;font-family:ui-monospace,monospace}',
  ].join('')
  document.head.appendChild(style)
}

function barPositionStyle(pos: Position | undefined): string {
  return pos === 'bottom' ? 'bottom:0' : 'top:0'
}

interface ActiveRender {
  el: DeliveryElement
  ctx: OnSiteContext
  reported: boolean
}

function reportImpression(state: ActiveRender): void {
  if (state.reported) return
  state.reported = true
  markShown(state.el)
  state.ctx.track('onsite_impression', {
    element_id: state.el.id,
    element_type: state.el.type,
    variant_id: state.el.variantId ?? null,
    ab_test_id: state.el.abTestId ?? null,
  })
}

function reportConversion(state: ActiveRender): void {
  state.ctx.track('onsite_conversion', {
    element_id: state.el.id,
    element_type: state.el.type,
    variant_id: state.el.variantId ?? null,
    ab_test_id: state.el.abTestId ?? null,
  })
}

function submitEmail(ctx: OnSiteContext, email: string): void {
  if (!email) return
  fetch(ctx.apiBase + '/v1/sdk/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchant_id: ctx.merchantId, anon_id: ctx.anonId, email }),
  }).catch(() => {})
}

function onCta(state: ActiveRender, root: HTMLElement, dismiss: () => void): void {
  const cfg = state.el.config
  if (cfg.captureEmail) {
    const input = root.querySelector('.eiq-os-input') as HTMLInputElement | null
    if (input) submitEmail(state.ctx, input.value.trim())
  }
  reportConversion(state)
  if (cfg.incentiveCode) {
    // Reveal the code in place instead of immediately navigating away.
    const codeEl = root.querySelector('.eiq-os-code') as HTMLElement | null
    if (codeEl && codeEl.style.display === 'none') {
      codeEl.style.display = 'inline-block'
      return
    }
  }
  if (cfg.ctaUrl) {
    window.location.href = cfg.ctaUrl
    return
  }
  dismiss()
}

function renderPopupOrBar(state: ActiveRender): void {
  ensureStyles()
  const { el } = state
  const cfg = el.config
  const isBar = el.type === 'STICKY_BAR'
  const container = document.createElement('div')
  const dismiss = () => container.remove()

  const ctaBtn = () => {
    const b = document.createElement('button')
    b.className = 'eiq-os-cta'
    b.textContent = cfg.ctaText || 'OK'
    b.addEventListener('click', () => onCta(state, container, dismiss))
    return b
  }

  if (isBar) {
    container.className = 'eiq-os-bar'
    container.setAttribute('style', barPositionStyle(cfg.position))
    const text = document.createElement('span')
    text.textContent = personalize(cfg.headline) || personalize(cfg.body)
    container.appendChild(text)
    if (cfg.ctaText) container.appendChild(ctaBtn())
    if (cfg.dismissible !== false) {
      const x = document.createElement('button')
      x.className = 'eiq-os-bar-x'
      x.setAttribute('aria-label', 'Dismiss')
      x.innerHTML = '&times;'
      x.addEventListener('click', dismiss)
      container.appendChild(x)
    }
    document.body.appendChild(container)
    reportImpression(state)
    return
  }

  // POPUP
  container.className = 'eiq-os-overlay'
  const card = document.createElement('div')
  card.className = 'eiq-os-card'

  if (cfg.dismissible !== false) {
    const x = document.createElement('button')
    x.className = 'eiq-os-x'
    x.setAttribute('aria-label', 'Close')
    x.innerHTML = '&times;'
    x.addEventListener('click', dismiss)
    card.appendChild(x)
  }
  if (cfg.imageUrl) {
    const img = document.createElement('img')
    img.className = 'eiq-os-img'
    img.src = cfg.imageUrl
    img.alt = ''
    card.appendChild(img)
  }
  if (cfg.headline) {
    const h = document.createElement('div')
    h.className = 'eiq-os-h'
    h.textContent = personalize(cfg.headline)
    card.appendChild(h)
  }
  if (cfg.body) {
    const b = document.createElement('div')
    b.className = 'eiq-os-b'
    b.textContent = personalize(cfg.body)
    card.appendChild(b)
  }
  if (cfg.captureEmail) {
    const input = document.createElement('input')
    input.className = 'eiq-os-input'
    input.type = 'email'
    input.placeholder = 'you@example.com'
    card.appendChild(input)
  }
  card.appendChild(ctaBtn())
  if (cfg.incentiveCode) {
    const code = document.createElement('span')
    code.className = 'eiq-os-code'
    code.style.display = 'none'
    code.textContent = cfg.incentiveCode
    card.appendChild(code)
  }

  // Backdrop click closes (dismissible popups only).
  if (cfg.dismissible !== false) {
    container.addEventListener('click', (e) => {
      if (e.target === container) dismiss()
    })
  }
  container.appendChild(card)
  document.body.appendChild(container)
  reportImpression(state)
}

function renderEmbed(state: ActiveRender): void {
  ensureStyles()
  const cfg = state.el.config
  const target = cfg.embedSelector ? document.querySelector(cfg.embedSelector) : null
  if (!target) return // no injection point on this page — silently skip
  const block = document.createElement('div')
  block.className = 'eiq-os-embed'
  if (cfg.headline) {
    const h = document.createElement('div')
    h.className = 'eiq-os-h'
    h.textContent = personalize(cfg.headline)
    block.appendChild(h)
  }
  if (cfg.body) {
    const b = document.createElement('div')
    b.className = 'eiq-os-b'
    b.textContent = personalize(cfg.body)
    block.appendChild(b)
  }
  if (cfg.ctaText) {
    const a = document.createElement('a')
    a.className = 'eiq-os-cta'
    a.textContent = cfg.ctaText
    a.href = cfg.ctaUrl || '#'
    a.addEventListener('click', () => reportConversion(state))
    block.appendChild(a)
  }
  target.appendChild(block)
  reportImpression(state)
}

function render(state: ActiveRender): void {
  if (!canShow(state.el)) return
  if (state.el.type === 'EMBED') renderEmbed(state)
  else renderPopupOrBar(state)
}

// ─── Trigger scheduling ───────────────────────────────────────────────────────

function schedule(el: DeliveryElement, ctx: OnSiteContext, isNewVisitor: boolean, cartValue: number): void {
  const rules = el.displayRules
  // Page-pattern gate (defense-in-depth; the server also filters when pagePath is sent).
  if (rules.pagePattern && !location.pathname.includes(rules.pagePattern)) return

  const state: ActiveRender = { el, ctx, reported: false }
  const show = () => render(state)

  switch (rules.trigger) {
    case 'new_visitor':
      if (isNewVisitor) show()
      break
    case 'timed':
      setTimeout(show, Math.max(0, (rules.timedDelaySeconds ?? 5) * 1000))
      break
    case 'cart_value':
      if (cartValue >= (rules.cartValueThreshold ?? 0)) show()
      break
    case 'product_view_restock':
      // Show on a product page the visitor viewed in an earlier load.
      if (currentProductId() && readViewedProducts().includes(currentProductId()!)) show()
      break
    case 'exit_intent':
      if (isMobile()) break
      {
        let fired = false
        document.addEventListener('mouseleave', (e) => {
          if (e.clientY <= 0 && !fired) {
            fired = true
            show()
          }
        })
      }
      break
    default:
      break
  }
}

// ─── Public entry ─────────────────────────────────────────────────────────────

export function initOnSite(ctx: OnSiteContext): void {
  // Determine new-visitor status BEFORE stamping the seen flag.
  const isNewVisitor = !lsGet(SEEN_KEY)
  lsSet(SEEN_KEY, '1')

  const viewedBefore = readViewedProducts()
  rememberCurrentProduct()

  fetchCartValue()
    .then((cartValue) => {
      const body = {
        merchantId: ctx.merchantId,
        anonId: ctx.anonId,
        customerId: ctx.customerId,
        pagePath: location.pathname,
        cartValue,
        viewedProductIds: viewedBefore,
      }
      return fetch(ctx.apiBase + '/api/v1/onsite/deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((json: any) => {
          const elements: DeliveryElement[] = json?.data?.elements ?? []
          for (const el of elements) schedule(el, ctx, isNewVisitor, cartValue)
        })
    })
    .catch(() => {
      /* delivery is best-effort — never break the storefront */
    })
}
