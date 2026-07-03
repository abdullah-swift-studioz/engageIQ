/**
 * The catalog of outbound-webhook event types a merchant can subscribe to.
 * These strings are the stable public contract (stored in OutboundWebhook.events and
 * sent as the `X-EngageIQ-Event` header / `event` body field). Do not rename existing
 * values — only add new ones.
 */
export const OUTBOUND_EVENTS = {
  SEGMENT_ENTERED: 'segment.entered',
  SEGMENT_EXITED: 'segment.exited',
  CAMPAIGN_COMPLETED: 'campaign.completed',
  COD_VERIFICATION_RESULT: 'cod.verification_result',
  CHURN_THRESHOLD_CROSSED: 'customer.churn_threshold',
} as const

export type OutboundEventType = (typeof OUTBOUND_EVENTS)[keyof typeof OUTBOUND_EVENTS]

/** All subscribable event types (used to validate webhook config + power the UI). */
export const ALL_OUTBOUND_EVENTS: OutboundEventType[] = Object.values(OUTBOUND_EVENTS)

/** A `ping` event is used by the "send test" action; it is deliverable but not subscribable. */
export const PING_EVENT = 'ping' as const

export function isValidOutboundEvent(event: string): event is OutboundEventType {
  return (ALL_OUTBOUND_EVENTS as string[]).includes(event)
}
