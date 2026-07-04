import { describe, it, expect } from 'vitest'
import type { EmailBlock, EmailRenderContext } from '@engageiq/shared'
import { renderEmail } from './render.js'
import { substituteTokens, extractTokens } from './tokens.js'

function ctx(overrides: Partial<EmailRenderContext> = {}): EmailRenderContext {
  return {
    customer: { firstName: 'Ayesha', lastName: 'Khan', email: 'ayesha@example.com', city: 'Lahore' },
    merchant: { name: 'Acme Store' },
    segmentIds: [],
    productsByBlockId: {},
    ...overrides,
  }
}

describe('substituteTokens', () => {
  it('resolves snake_case customer tokens against the camelCase record', () => {
    expect(substituteTokens('Hi {{customer.first_name}}!', ctx())).toBe('Hi Ayesha!')
  })

  it('uses the |fallback when a field resolves empty', () => {
    const c = ctx({ customer: { email: 'x@y.com' } })
    expect(substituteTokens('Hi {{customer.first_name|there}}!', c)).toBe('Hi there!')
  })

  it('resolves empty (no fallback) to an empty string', () => {
    const c = ctx({ customer: {} })
    expect(substituteTokens('Hi {{customer.first_name}}!', c)).toBe('Hi !')
  })

  it('resolves order and merchant namespaces', () => {
    const c = ctx({ order: { totalPrice: '2499' }, merchant: { name: 'Acme' } })
    expect(substituteTokens('{{merchant.name}}: {{order.total_price}}', c)).toBe('Acme: 2499')
  })

  it('extractTokens returns distinct namespace.field pairs', () => {
    const found = extractTokens('{{customer.first_name}} {{customer.first_name}} {{order.total}}')
    expect(found).toHaveLength(2)
  })
})

describe('renderEmail', () => {
  it('renders text/button/divider/spacer blocks into an HTML document', () => {
    const blocks: EmailBlock[] = [
      { id: 'b1', type: 'text', html: '<p>Hello {{customer.first_name}}</p>' },
      { id: 'b2', type: 'button', text: 'Shop now', href: 'https://shop.example/sale' },
      { id: 'b3', type: 'divider' },
      { id: 'b4', type: 'spacer', height: 24 },
    ]
    const { html, text } = renderEmail({ blocks, subject: 'Sale', ctx: ctx() })
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Hello Ayesha')
    expect(html).toContain('https://shop.example/sale')
    expect(html).toContain('Shop now')
    expect(text).toContain('Hello Ayesha')
    expect(text).toContain('Shop now: https://shop.example/sale')
  })

  it('escapes markup injected via a personalization field', () => {
    const c = ctx({ customer: { firstName: '<script>alert(1)</script>' } })
    const blocks: EmailBlock[] = [{ id: 'b1', type: 'text', html: 'Hi {{customer.first_name}}' }]
    const { html } = renderEmail({ blocks, subject: 's', ctx: c })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders a conditional block only for members of its segment', () => {
    const blocks: EmailBlock[] = [
      {
        id: 'cond',
        type: 'conditional',
        segmentId: 'seg_vip',
        blocks: [{ id: 't', type: 'text', html: 'VIP early access' }],
      },
    ]
    expect(renderEmail({ blocks, subject: 's', ctx: ctx({ segmentIds: [] }) }).html).not.toContain(
      'VIP early access',
    )
    expect(
      renderEmail({ blocks, subject: 's', ctx: ctx({ segmentIds: ['seg_vip'] }) }).html,
    ).toContain('VIP early access')
  })

  it('renders a dynamic-product block from resolved products, capped to limit', () => {
    const blocks: EmailBlock[] = [
      { id: 'dp', type: 'dynamic-product', source: 'top_sellers', limit: 2, columns: 2, heading: 'Top sellers' },
    ]
    const c = ctx({
      productsByBlockId: {
        dp: [
          { id: 'p1', title: 'Kurta', price: 'PKR 2,499', url: 'https://s/p1', imageUrl: 'https://s/p1.jpg' },
          { id: 'p2', title: 'Shawl', price: 'PKR 1,299', url: 'https://s/p2', imageUrl: 'https://s/p2.jpg' },
          { id: 'p3', title: 'Extra', price: 'PKR 999', url: 'https://s/p3' },
        ],
      },
    })
    const { html, text } = renderEmail({ blocks, subject: 's', ctx: c })
    expect(html).toContain('Top sellers')
    expect(html).toContain('Kurta')
    expect(html).toContain('Shawl')
    expect(html).not.toContain('Extra') // capped to limit=2
    expect(text).toContain('Kurta — PKR 2,499')
  })

  it('omits an empty dynamic-product block', () => {
    const blocks: EmailBlock[] = [
      { id: 'dp', type: 'dynamic-product', source: 'recommended', limit: 4 },
    ]
    const { html } = renderEmail({ blocks, subject: 's', ctx: ctx() })
    expect(html).not.toContain('product-grid')
  })

  it('includes an unsubscribe link and open-tracking pixel when provided', () => {
    const blocks: EmailBlock[] = [{ id: 'b1', type: 'text', html: 'Hi' }]
    const c = ctx({
      unsubscribeUrl: 'https://track.example/u/abc',
      openTrackingUrl: 'https://track.example/o/abc.gif',
    })
    const { html } = renderEmail({ blocks, subject: 's', ctx: c })
    expect(html).toContain('https://track.example/u/abc')
    expect(html).toContain('https://track.example/o/abc.gif')
  })
})
