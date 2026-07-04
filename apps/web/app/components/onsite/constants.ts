// Client-safe option lists + labels shared across the On-Site routes.
import type {
  OnSiteElementTypeName,
  OnSiteTriggerType,
  OnSiteFrequency,
  OnSitePosition,
  OnSiteElementStatusName,
  OnSiteDisplayRules,
} from '@engageiq/shared'

export const TYPE_OPTIONS: { value: OnSiteElementTypeName; label: string }[] = [
  { value: 'POPUP', label: 'Popup' },
  { value: 'STICKY_BAR', label: 'Sticky bar' },
  { value: 'EMBED', label: 'Inline embed' },
]

export const STATUS_OPTIONS: { value: OnSiteElementStatusName; label: string }[] = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'ARCHIVED', label: 'Archived' },
]

export const TRIGGER_OPTIONS: { value: OnSiteTriggerType; label: string }[] = [
  { value: 'new_visitor', label: 'New visitor' },
  { value: 'exit_intent', label: 'Exit intent' },
  { value: 'timed', label: 'Timed (after N seconds)' },
  { value: 'cart_value', label: 'Cart value threshold' },
  { value: 'product_view_restock', label: 'Product re-view / restock' },
]

export const FREQUENCY_OPTIONS: { value: OnSiteFrequency; label: string }[] = [
  { value: 'once_per_session', label: 'Once per session' },
  { value: 'once_per_day', label: 'Once per day' },
  { value: 'once_ever', label: 'Once ever' },
  { value: 'always', label: 'Every page load' },
]

export const POSITION_OPTIONS: { value: OnSitePosition; label: string }[] = [
  { value: 'center', label: 'Center' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'bottom_left', label: 'Bottom-left' },
  { value: 'bottom_right', label: 'Bottom-right' },
]

export const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  TYPE_OPTIONS.map((o) => [o.value, o.label]),
)
export const TRIGGER_LABEL: Record<string, string> = Object.fromEntries(
  TRIGGER_OPTIONS.map((o) => [o.value, o.label]),
)

/** One-line human summary of a display rule for the list table. */
export function describeTrigger(rules: OnSiteDisplayRules | null | undefined): string {
  if (!rules) return '—'
  const base = TRIGGER_LABEL[rules.trigger] ?? rules.trigger
  if (rules.trigger === 'timed' && rules.timedDelaySeconds != null) {
    return `${base} · ${rules.timedDelaySeconds}s`
  }
  if (rules.trigger === 'cart_value' && rules.cartValueThreshold != null) {
    return `${base} · ≥ ${rules.cartValueThreshold}`
  }
  return base
}
