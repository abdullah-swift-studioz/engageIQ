import { describe, it, expect } from 'vitest'
import { scoreSpam } from './spam-score.js'

const cleanHtml = '<p>Hi, here is our weekly update.</p><p>Thanks for reading — plenty of context here so the email is not image heavy.</p><a href="https://shop/unsubscribe">Unsubscribe</a>'
const cleanText = 'Hi, here is our weekly update. Thanks for reading — plenty of context here. Unsubscribe: https://shop/unsubscribe'

describe('scoreSpam', () => {
  it('gives a clean, well-formed email a good rating', () => {
    const r = scoreSpam({ subject: 'Your weekly picks are here', html: cleanHtml, text: cleanText })
    expect(r.rating).toBe('good')
    expect(r.score).toBeGreaterThanOrEqual(80)
    expect(r.issues).toHaveLength(0)
  })

  it('flags an empty subject as a high-severity issue', () => {
    const r = scoreSpam({ subject: '', html: cleanHtml, text: cleanText })
    expect(r.issues.find((i) => i.id === 'subject-empty')?.severity).toBe('high')
  })

  it('flags an all-caps shouty subject with trigger words and exclamations', () => {
    const r = scoreSpam({
      subject: 'FREE CASH WINNER ACT NOW!!!',
      html: cleanHtml,
      text: cleanText,
    })
    const ids = r.issues.map((i) => i.id)
    expect(ids).toContain('subject-caps')
    expect(ids).toContain('subject-triggers')
    expect(ids).toContain('subject-exclaim')
    expect(r.rating).not.toBe('good')
  })

  it('flags a missing unsubscribe link and missing text part', () => {
    const r = scoreSpam({ subject: 'Hello', html: '<p>No unsub here</p>', text: '' })
    const ids = r.issues.map((i) => i.id)
    expect(ids).toContain('no-unsubscribe')
    expect(ids).toContain('no-text-part')
  })

  it('flags an image-heavy body with little text', () => {
    const r = scoreSpam({
      subject: 'Look',
      html: '<img src="a.jpg"/><img src="b.jpg"/> unsubscribe',
      text: 'unsubscribe',
    })
    expect(r.issues.map((i) => i.id)).toContain('image-heavy')
  })

  it('never returns a score outside 0–100', () => {
    const r = scoreSpam({ subject: 'FREE CASH WINNER ACT NOW BUY NOW CLICK HERE!!!', html: '<img/><img/>http://x', text: '' })
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(100)
  })
})
