// apps/api/src/services/email/spam-score.ts
//
// Heuristic spam-score checker surfaced in the builder before send (guide 7.3: "flags
// issues before send"). Not a full SpamAssassin — a fast, dependency-free set of the
// deliverability heuristics that actually bite Pakistani/MENA senders (trigger words,
// shouty subjects, missing unsubscribe, image-heavy bodies, no plain-text part).
//
// Returns a 0–100 score (higher = safer) plus the itemized issues that lowered it, so
// the UI can show both a headline number and actionable fixes.

export type SpamSeverity = 'high' | 'medium' | 'low'
export type SpamRating = 'good' | 'fair' | 'poor'

export interface SpamIssue {
  id: string
  severity: SpamSeverity
  message: string
}

export interface SpamScoreResult {
  score: number // 0–100, higher is better
  rating: SpamRating
  issues: SpamIssue[]
}

export interface SpamScoreInput {
  subject: string
  html: string
  text: string
}

// Trigger words/phrases that commonly raise spam scores in subject lines.
const SUBJECT_TRIGGERS = [
  'free', 'winner', 'cash', 'act now', 'buy now', 'click here', 'limited time',
  'risk-free', 'guarantee', '100%', 'urgent', 'congratulations', 'double your',
  'earn money', 'no cost', 'why pay more',
]

const PENALTY: Record<SpamSeverity, number> = { high: 22, medium: 10, low: 4 }

function ratingFor(score: number): SpamRating {
  if (score >= 80) return 'good'
  if (score >= 60) return 'fair'
  return 'poor'
}

function countMatches(haystack: string, re: RegExp): number {
  return (haystack.match(re) ?? []).length
}

export function scoreSpam(input: SpamScoreInput): SpamScoreResult {
  const issues: SpamIssue[] = []
  const subject = input.subject ?? ''
  const html = input.html ?? ''
  const text = input.text ?? ''

  const add = (id: string, severity: SpamSeverity, message: string) => issues.push({ id, severity, message })

  // ── Subject ────────────────────────────────────────────────────────────────
  if (subject.trim() === '') {
    add('subject-empty', 'high', 'Subject line is empty.')
  } else {
    if (subject.length > 90) add('subject-long', 'medium', 'Subject is over 90 characters and may be truncated.')

    const letters = subject.replace(/[^a-zA-Z]/g, '')
    if (letters.length >= 8 && letters === letters.toUpperCase()) {
      add('subject-caps', 'medium', 'Subject is all uppercase — reads as shouting to spam filters.')
    }

    const excl = countMatches(subject, /!/g)
    if (excl >= 3) add('subject-exclaim', 'medium', 'Three or more exclamation marks in the subject.')
    else if (excl === 2) add('subject-exclaim', 'low', 'Multiple exclamation marks in the subject.')

    if (/\$|₨|rs\.?\s?\d/i.test(subject)) add('subject-money', 'low', 'Currency amounts in the subject can trigger filters.')

    const lower = subject.toLowerCase()
    const hits = SUBJECT_TRIGGERS.filter((t) => lower.includes(t))
    if (hits.length > 0) {
      add('subject-triggers', hits.length >= 2 ? 'medium' : 'low', `Spam-trigger words in subject: ${hits.slice(0, 4).join(', ')}.`)
    }
  }

  // ── Body ─────────────────────────────────────────────────────────────────────
  if (text.trim() === '') {
    add('no-text-part', 'medium', 'No plain-text alternative — hurts deliverability and accessibility.')
  }

  if (!/unsubscribe/i.test(html) && !/unsubscribe/i.test(text)) {
    add('no-unsubscribe', 'high', 'No unsubscribe link found — required by anti-spam laws and filters.')
  }

  const linkCount = countMatches(html, /<a\s[^>]*href=/gi)
  if (linkCount > 20) add('too-many-links', 'medium', `High link count (${linkCount}); trim to improve deliverability.`)

  const imgCount = countMatches(html, /<img\s/gi)
  const textLen = text.replace(/\s+/g, ' ').trim().length
  if (imgCount > 0 && textLen < 200) {
    add('image-heavy', 'medium', 'Image-heavy with little text — many filters penalize image-only emails.')
  }

  if (countMatches(html, /http:\/\//gi) > 0) {
    add('insecure-links', 'low', 'Contains non-HTTPS (http://) links.')
  }

  // ── Score ────────────────────────────────────────────────────────────────────
  const penalty = issues.reduce((sum, i) => sum + PENALTY[i.severity], 0)
  const score = Math.max(0, Math.min(100, 100 - penalty))
  return { score, rating: ratingFor(score), issues }
}
