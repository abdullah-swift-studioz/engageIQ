import { describe, it, expect } from 'vitest'
import {
  normalizeReply,
  keywordMatches,
  matchBranch,
  classifyVerificationReply,
} from './keywords.js'
import type { JourneyReplyBranch } from '@engageiq/shared'

describe('normalizeReply', () => {
  it('lowercases, strips punctuation/emoji, collapses whitespace', () => {
    expect(normalizeReply('  CONFIRM! ✅ ')).toBe('confirm')
    expect(normalizeReply('Yes   please')).toBe('yes please')
    expect(normalizeReply('haan-ji')).toBe('haan ji')
  })

  it('keeps letters and numbers (incl. non-latin)', () => {
    expect(normalizeReply('Order #123')).toBe('order 123')
  })
})

describe('keywordMatches', () => {
  it('matches a whole-word single-token keyword, not a substring', () => {
    expect(keywordMatches('yes please', 'yes')).toBe(true)
    expect(keywordMatches('yesterday', 'yes')).toBe(false) // not a whole word
  })

  it('matches an exact reply', () => {
    expect(keywordMatches('confirm', 'confirm')).toBe(true)
  })

  it('matches a multi-word keyword as a substring', () => {
    expect(keywordMatches('please cancel order now', 'cancel order')).toBe(true)
  })

  it('ignores empty keywords', () => {
    expect(keywordMatches('anything', '')).toBe(false)
  })
})

describe('matchBranch', () => {
  const branches: JourneyReplyBranch[] = [
    { label: 'confirmed', keywords: ['confirm', 'yes', 'haan'] },
    { label: 'cancelled', keywords: ['cancel', 'no', 'nahi'] },
  ]

  it('returns the label of the first matching branch', () => {
    expect(matchBranch('CONFIRM', branches)).toBe('confirmed')
    expect(matchBranch('nahi', branches)).toBe('cancelled')
    expect(matchBranch('Haan ji bilkul', branches)).toBe('confirmed')
  })

  it('returns null when nothing matches', () => {
    expect(matchBranch('where is my order', branches)).toBeNull()
    expect(matchBranch('', branches)).toBeNull()
  })

  it('respects branch order (first match wins)', () => {
    const ordered: JourneyReplyBranch[] = [
      { label: 'a', keywords: ['ok'] },
      { label: 'b', keywords: ['ok', 'okay'] },
    ]
    expect(matchBranch('ok', ordered)).toBe('a')
  })
})

describe('classifyVerificationReply', () => {
  it('classifies English + Roman-Urdu confirm words', () => {
    expect(classifyVerificationReply('yes')).toBe('CONFIRM')
    expect(classifyVerificationReply('CONFIRM ✅')).toBe('CONFIRM')
    expect(classifyVerificationReply('ji haan')).toBe('CONFIRM')
    expect(classifyVerificationReply('1')).toBe('CONFIRM')
  })

  it('classifies cancel words', () => {
    expect(classifyVerificationReply('no')).toBe('CANCEL')
    expect(classifyVerificationReply('cancel')).toBe('CANCEL')
    expect(classifyVerificationReply('nahi')).toBe('CANCEL')
    expect(classifyVerificationReply('2')).toBe('CANCEL')
  })

  it('returns UNKNOWN for anything ambiguous', () => {
    expect(classifyVerificationReply('maybe later')).toBe('UNKNOWN')
    expect(classifyVerificationReply('')).toBe('UNKNOWN')
  })
})
