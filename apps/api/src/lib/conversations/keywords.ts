// apps/api/src/lib/conversations/keywords.ts
//
// Pure reply-matching for the two-way WhatsApp engine (guide §7.2). No IO — unit-tested in
// isolation. Matching is deliberately forgiving: WhatsApp quick-reply buttons send the exact
// title, but free-text customers type "yes please", "haan ji", "CONFIRM ✅", etc. We normalize
// both sides and match a branch if the reply equals a keyword, contains it as a whole word, or
// (for multi-word keywords) contains it as a substring.
import type { JourneyReplyBranch } from '@engageiq/shared'

// Lowercase, strip surrounding punctuation/emoji, collapse internal whitespace. Kept intentionally
// simple (no unicode diacritic folding) so Roman-Urdu keywords ("haan", "nahi") match verbatim.
export function normalizeReply(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // drop punctuation & emoji, keep letters/numbers/space
    .replace(/\s+/g, ' ')
    .trim()
}

// Does a single keyword match the normalized reply? Whole-word for single-token keywords,
// substring for multi-token keywords (e.g. "cancel order").
export function keywordMatches(normalizedReply: string, keyword: string): boolean {
  const k = normalizeReply(keyword)
  if (k.length === 0) return false
  if (normalizedReply === k) return true
  if (k.includes(' ')) return normalizedReply.includes(k)
  return normalizedReply.split(' ').includes(k)
}

// Return the `label` of the first branch whose keywords match the reply, or null if none match.
// Branch order is significant (first match wins), so callers should list the most specific first.
export function matchBranch(text: string, branches: JourneyReplyBranch[]): string | null {
  const normalized = normalizeReply(text)
  if (normalized.length === 0) return null
  for (const branch of branches) {
    if (branch.keywords.some((k) => keywordMatches(normalized, k))) return branch.label
  }
  return null
}

// Default confirm / cancel vocabularies (English + Roman-Urdu), used to classify COD-verification
// replies. Exported so the COD verify lane can reuse the exact same classification later.
export const DEFAULT_CONFIRM_KEYWORDS = [
  'confirm', 'confirmed', 'yes', 'y', 'yeah', 'yep', 'ok', 'okay', 'sure', 'proceed', 'accept',
  'haan', 'han', 'ha', 'ji', 'jee', 'theek', 'sahi', 'bilkul', '1',
]

export const DEFAULT_CANCEL_KEYWORDS = [
  'cancel', 'cancelled', 'no', 'n', 'nope', 'nah', 'reject', 'decline', 'return',
  'nahi', 'nai', 'na', 'mansookh', '2',
]

const VERIFICATION_BRANCHES: JourneyReplyBranch[] = [
  { label: 'CONFIRM', keywords: DEFAULT_CONFIRM_KEYWORDS },
  { label: 'CANCEL', keywords: DEFAULT_CANCEL_KEYWORDS },
]

// Classify a COD-verification reply into a confirm / cancel decision (or UNKNOWN if ambiguous).
export function classifyVerificationReply(text: string): 'CONFIRM' | 'CANCEL' | 'UNKNOWN' {
  const label = matchBranch(text, VERIFICATION_BRANCHES)
  return label === 'CONFIRM' || label === 'CANCEL' ? label : 'UNKNOWN'
}
