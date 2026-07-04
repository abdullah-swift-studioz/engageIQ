import { describe, it, expect } from 'vitest'
import { buildVerificationPrompt, renderTemplate, formatPkr } from './prompt.js'
import { DEFAULT_COD_VERIFICATION_CONFIG } from './config.js'

describe('formatPkr', () => {
  it('groups thousands and rounds to whole rupees', () => {
    expect(formatPkr(1500)).toBe('1,500')
    expect(formatPkr(1234567)).toBe('1,234,567')
    expect(formatPkr(999.6)).toBe('1,000')
    expect(formatPkr(0)).toBe('0')
  })
})

describe('renderTemplate', () => {
  it('substitutes known tokens and leaves unknown ones untouched', () => {
    const out = renderTemplate('Order {{orderNumber}} for Rs. {{amount}} — {{mystery}}', {
      orderNumber: '1001',
      amount: 25000,
    })
    expect(out).toBe('Order 1001 for Rs. 25,000 — {{mystery}}')
  })

  it('derives firstNameComma and productClause conditionally', () => {
    const withBoth = renderTemplate('Hi{{firstNameComma}}{{productClause}}', {
      orderNumber: '1',
      amount: 1,
      firstName: 'Ayesha',
      product: 'Kurta',
    })
    expect(withBoth).toBe('Hi, Ayesha for Kurta')

    const withNeither = renderTemplate('Hi{{firstNameComma}}{{productClause}}', { orderNumber: '1', amount: 1 })
    expect(withNeither).toBe('Hi')
  })
})

describe('buildVerificationPrompt', () => {
  it('builds the default bilingual prompt with order ref + amount + YES/NO instruction', () => {
    const body = buildVerificationPrompt(
      { orderNumber: '1042', amount: 4999, product: null, firstName: null },
      DEFAULT_COD_VERIFICATION_CONFIG,
    )
    expect(body).toContain('Assalam-o-Alaikum')
    expect(body).toContain('#1042')
    expect(body).toContain('Rs. 4,999')
    expect(body).toContain('YES')
    expect(body).toContain('NO')
  })

  it('honours a merchant override template', () => {
    const body = buildVerificationPrompt(
      { orderNumber: '7', amount: 100, firstName: 'Bilal' },
      { ...DEFAULT_COD_VERIFICATION_CONFIG, promptTemplate: 'Salam {{firstName}}, confirm order {{orderNumber}}?' },
    )
    expect(body).toBe('Salam Bilal, confirm order 7?')
  })
})
