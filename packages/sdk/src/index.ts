/**
 * EngageIQ Storefront Tracking SDK
 * Injected via Shopify App Embed Block — no theme editing required.
 * Target: <5KB gzipped
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { initOnSite } from './onsite';

(function (win: Window & typeof globalThis) {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────

  const ANON_COOKIE = '_eiq_anon';
  const SESSION_KEY = '_eiq_sess';
  const SCROLL_THRESHOLDS = [25, 50, 75, 100];
  const BATCH_SIZE = 10;
  const FLUSH_DELAY_MS = 3000;

  // ─── Types ──────────────────────────────────────────────────────────────────

  interface SdkEvent {
    event_name: string;
    anon_id: string;
    customer_id: string | null;
    session_id: string;
    merchant_id: string;
    page_url: string;
    properties: Record<string, unknown>;
    timestamp: string;
  }

  interface IdentifyPayload {
    email?: string;
    phone?: string;
    shopify_customer_id?: string;
  }

  // ─── State ──────────────────────────────────────────────────────────────────

  let _merchantId = '';
  let _apiBase = '';
  let _queue: SdkEvent[] = [];
  let _flushTimer: ReturnType<typeof setTimeout> | null = null;
  let _initialized = false;
  // Capture currentScript synchronously — null after script execution ends
  const _currentScript = document.currentScript as HTMLScriptElement | null;

  // ─── Utilities ──────────────────────────────────────────────────────────────

  function genUuid(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 3) | 8).toString(16);
    });
  }

  function getCookie(name: string): string | null {
    const m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
    return m ? decodeURIComponent(m[1]!) : null;
  }

  function setCookie(name: string, value: string, days = 365): void {
    const exp = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + exp + '; path=/; SameSite=Lax';
  }

  function getAnonId(): string {
    let id = getCookie(ANON_COOKIE);
    if (!id) {
      id = genUuid();
      setCookie(ANON_COOKIE, id);
    }
    return id;
  }

  function getSessionId(): string {
    try {
      let id = sessionStorage.getItem(SESSION_KEY);
      if (!id) {
        id = genUuid();
        sessionStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch {
      // sessionStorage blocked (private browsing, iframe)
      return genUuid();
    }
  }

  function isMobile(): boolean {
    return /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent);
  }

  function getShopifyCustomerId(): string | null {
    // window.Shopify.customer is populated when a customer is logged in
    const shopify = (win as any).Shopify;
    return shopify?.customer?.id ? String(shopify.customer.id) : null;
  }

  // ─── Event Queue & Flush ─────────────────────────────────────────────────────

  function buildEvent(name: string, props: Record<string, unknown>): SdkEvent {
    return {
      event_name: name,
      anon_id: getAnonId(),
      customer_id: getShopifyCustomerId(),
      session_id: getSessionId(),
      merchant_id: _merchantId,
      page_url: location.href,
      properties: {
        device_type: isMobile() ? 'mobile' : 'desktop',
        referrer: document.referrer || null,
        ...props,
      },
      timestamp: new Date().toISOString(),
    };
  }

  function doFlush(useBeacon = false): void {
    if (_flushTimer) {
      clearTimeout(_flushTimer);
      _flushTimer = null;
    }
    if (!_queue.length) return;

    const batch = _queue.splice(0);
    const url = _apiBase + '/v1/sdk/events';
    const body = JSON.stringify({ events: batch });

    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {/* fire and forget */});
    }
  }

  function scheduleFlush(): void {
    if (!_flushTimer) {
      _flushTimer = setTimeout(() => doFlush(), FLUSH_DELAY_MS);
    }
  }

  // ─── Public: track ───────────────────────────────────────────────────────────

  function track(name: string, props: Record<string, unknown> = {}): void {
    if (!_initialized || !_merchantId) return;
    _queue.push(buildEvent(name, props));
    if (_queue.length >= BATCH_SIZE) {
      doFlush();
    } else {
      scheduleFlush();
    }
  }

  // ─── Public: identify ────────────────────────────────────────────────────────

  function identify(payload: IdentifyPayload): void {
    if (!_merchantId) return;
    fetch(_apiBase + '/v1/sdk/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchant_id: _merchantId,
        anon_id: getAnonId(),
        ...payload,
      }),
    }).catch(() => {});
  }

  // ─── Auto-tracking ───────────────────────────────────────────────────────────

  function trackPageView(): void {
    const sa = (win as any).ShopifyAnalytics;
    const meta = sa?.meta;

    track('page_view', {
      title: document.title,
      path: location.pathname,
    });

    // Product page
    if (meta?.product) {
      const p = meta.product;
      const price = p.variants?.[0]?.price;
      track('product_view', {
        product_id: String(p.id),
        product_title: p.title ?? null,
        product_type: p.type ?? null,
        price: price != null ? price / 100 : null, // Shopify stores price in cents
        currency: (win as any).Shopify?.currency?.active ?? 'PKR',
      });
    } else if (meta?.page?.pageType === 'collection') {
      track('collection_view', {
        collection_handle: location.pathname.replace(/^\/collections\//, ''),
      });
    }

    // Cart page
    if (location.pathname === '/cart') {
      track('cart_view', { path: location.pathname });
    }

    // Search results page
    if (location.pathname === '/search') {
      const q = new URLSearchParams(location.search).get('q') || '';
      if (q) track('search_query', { query: q });
    }
  }

  function trackScrollDepth(): void {
    const reached = new Set<number>();
    win.addEventListener(
      'scroll',
      () => {
        const total = document.documentElement.scrollHeight - win.innerHeight;
        if (total <= 0) return;
        const pct = Math.min(100, Math.round((win.scrollY / total) * 100));
        for (const t of SCROLL_THRESHOLDS) {
          if (pct >= t && !reached.has(t)) {
            reached.add(t);
            track('scroll_depth', { depth_percent: t });
          }
        }
      },
      { passive: true },
    );
  }

  function trackPageExit(): void {
    const start = Date.now();

    // time_on_page + flush on page hide
    win.addEventListener('pagehide', () => {
      track('time_on_page', {
        seconds: Math.round((Date.now() - start) / 1000),
        path: location.pathname,
      });
      doFlush(true);
    });

    // Fallback for browsers that don't fire pagehide reliably
    win.addEventListener('beforeunload', () => doFlush(true));

    // Exit intent (desktop only — mouse moves above viewport top)
    if (!isMobile()) {
      let fired = false;
      document.addEventListener('mouseleave', (e) => {
        if (e.clientY <= 0 && !fired) {
          fired = true;
          track('exit_intent', { path: location.pathname });
        }
      });
    }
  }

  function trackCartInteractions(): void {
    // add_to_cart: form[action*="/cart/add"] submit (standard Shopify themes)
    document.addEventListener('submit', (e) => {
      const form = (e.target as HTMLElement)?.closest?.('form') as HTMLFormElement | null;
      if (!form?.action?.includes('/cart/add')) return;
      const variantId = (form.querySelector('[name="id"]') as HTMLInputElement | null)?.value ?? null;
      track('add_to_cart', { variant_id: variantId, path: location.pathname });
    });

    // add_to_cart: AJAX "Add" buttons used by some themes
    document.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement)?.closest?.(
        '[data-action="add-to-cart"], .btn-addtocart, [data-add-to-cart], [name="add"]',
      );
      if (btn) track('add_to_cart', { path: location.pathname });
    });

    // remove_from_cart: cart quantity form changes with value 0
    document.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement | null;
      if (
        input?.type === 'number' &&
        input.closest?.('form[action*="/cart"]') &&
        parseInt(input.value, 10) === 0
      ) {
        track('remove_from_cart', { path: location.pathname });
      }
    });

    // checkout_started: checkout button click
    document.addEventListener('click', (e) => {
      if (
        (e.target as HTMLElement)?.closest?.(
          '[name="checkout"], .cart__checkout, [data-checkout-btn], button[type="submit"][data-checkout]',
        )
      ) {
        track('checkout_started', { path: location.pathname });
      }
    });

    // product_image_zoom: click on product media
    document.addEventListener('click', (e) => {
      if (
        (e.target as HTMLElement)?.closest?.(
          '.product__media, .product-media-container, [data-zoom], .product-single__photo',
        )
      ) {
        track('product_image_zoom', { path: location.pathname });
      }
    });
  }

  // ─── Checkout step tracking via Shopify's custom event ──────────────────────

  function trackCheckoutSteps(): void {
    // Shopify fires this event on checkout page step changes
    document.addEventListener('page:load', () => {
      if (location.pathname.startsWith('/checkout')) {
        const step = new URLSearchParams(location.search).get('step') || 'contact_information';
        track('checkout_step', { step, path: location.pathname });
      }
    });
  }

  // ─── Initialization ──────────────────────────────────────────────────────────

  function init(config: { merchantId: string; apiBase: string }): void {
    if (_initialized) return;

    _merchantId = config.merchantId;
    _apiBase = config.apiBase.replace(/\/$/, '');
    _initialized = true;

    // Auto-identify known Shopify customers
    const customerId = getShopifyCustomerId();
    if (customerId) {
      identify({ shopify_customer_id: customerId });
    }

    trackPageView();
    trackScrollDepth();
    trackPageExit();
    trackCartInteractions();
    trackCheckoutSteps();

    // On-site personalization: fetch + render eligible popups / bars / embeds,
    // reporting impressions & conversions through the same `track` pipeline.
    initOnSite({
      apiBase: _apiBase,
      merchantId: _merchantId,
      anonId: getAnonId(),
      customerId: getShopifyCustomerId(),
      track,
    });
  }

  // ─── Auto-init from script data attributes ───────────────────────────────────
  // Usage: <script src=".../sdk.js"
  //               data-merchant-id="cld123..."
  //               data-api-base="https://api.engageiq.app"
  //               async></script>

  function autoInit(): void {
    const el: HTMLScriptElement | null =
      _currentScript || (document.querySelector('script[data-merchant-id]') as HTMLScriptElement | null);
    if (!el) return;
    const mid = el.getAttribute('data-merchant-id');
    const base = el.getAttribute('data-api-base');
    if (mid && base) init({ merchantId: mid, apiBase: base });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

  // ─── Web Push subscription (lane:push) ───────────────────────────────────────
  // Registers the service worker, requests notification permission, subscribes via the
  // PushManager using the server's VAPID public key, and POSTs the subscription to the API.
  // Call it from a user gesture (browsers block permission prompts otherwise):
  //   EngageIQ.subscribePush().then((ok) => { ... })

  function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = win.atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function subscribePush(opts: { swPath?: string } = {}): Promise<boolean> {
    try {
      if (!_merchantId || !_apiBase) return false;
      if (!('serviceWorker' in navigator) || !('PushManager' in win) || !('Notification' in win)) return false;

      const permission = await (win as any).Notification.requestPermission();
      if (permission !== 'granted') return false;

      const reg = await navigator.serviceWorker.register(opts.swPath || '/eiq-sw.js');
      await navigator.serviceWorker.ready;

      // Fetch the server VAPID public key.
      const keyRes = await fetch(_apiBase + '/api/v1/push/vapid-public-key');
      if (!keyRes.ok) return false;
      const keyJson = await keyRes.json();
      const publicKey = keyJson && keyJson.data && keyJson.data.publicKey;
      if (!publicKey) return false;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const res = await fetch(_apiBase + '/api/v1/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: _merchantId,
          anon_id: getAnonId(),
          customer_id: getShopifyCustomerId() || undefined,
          subscription: sub.toJSON(),
          user_agent: navigator.userAgent,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  (win as any).EngageIQ = { init, track, identify, subscribePush };
})(window);
