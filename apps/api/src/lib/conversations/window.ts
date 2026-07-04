// apps/api/src/lib/conversations/window.ts
//
// Pure time math for the two-way WhatsApp engine (guide §7.2 "24-hour conversation window").
// WhatsApp only permits free-form (non-template) business replies within 24h of the customer's
// last inbound message. We track that window off WhatsAppConversation.lastInboundAt.
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000

// Is the free-form service window still open? Open iff the customer messaged within the last 24h.
export function isWithinServiceWindow(lastInboundAt: Date | null | undefined, now: Date): boolean {
  if (!lastInboundAt) return false
  return now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS
}

// Milliseconds remaining in the service window (0 once closed).
export function serviceWindowRemainingMs(lastInboundAt: Date | null | undefined, now: Date): number {
  if (!lastInboundAt) return 0
  return Math.max(0, lastInboundAt.getTime() + SERVICE_WINDOW_MS - now.getTime())
}

// The absolute deadline for an awaiting-reply step: now + timeoutMinutes (min 1 minute so a
// mis-configured 0 never produces an already-expired wait).
export function computeTimeoutAt(now: Date, timeoutMinutes: number): Date {
  const minutes = Number.isFinite(timeoutMinutes) && timeoutMinutes > 0 ? timeoutMinutes : 1
  return new Date(now.getTime() + minutes * 60_000)
}
