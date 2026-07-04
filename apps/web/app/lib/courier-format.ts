// apps/web/app/lib/courier-format.ts
//
// Presentation helpers for the Shipments UI. Per the design system, shipment state is
// conveyed with SHADE + ICON + WEIGHT — never a hue. statusPresentation maps each
// ShipmentStatus to a monochrome Badge variant + an icon + a human label.
import type { ComponentType } from 'react'
import type { BadgeVariant } from '~/components/ui'
import { AlertTriangle, AlertCircle, CheckCircle, XCircle, ArrowRight, Info } from '~/components/ui/icons'
import type { IconProps } from '~/components/ui/icons'

export interface StatusPresentation {
  label: string
  variant: BadgeVariant
  icon: ComponentType<IconProps>
}

const MAP: Record<string, StatusPresentation> = {
  CREATED: { label: 'Created', variant: 'subtle', icon: Info },
  DISPATCHED: { label: 'Dispatched', variant: 'subtle', icon: ArrowRight },
  IN_TRANSIT: { label: 'In transit', variant: 'subtle', icon: ArrowRight },
  OUT_FOR_DELIVERY: { label: 'Out for delivery', variant: 'outline', icon: ArrowRight },
  ATTEMPTED: { label: 'Attempted', variant: 'outline', icon: AlertCircle },
  DELIVERED: { label: 'Delivered', variant: 'solid', icon: CheckCircle },
  RETURN_IN_TRANSIT: { label: 'Return in transit', variant: 'subtle', icon: AlertTriangle },
  RETURNED: { label: 'Returned', variant: 'outline', icon: AlertTriangle },
  UNDELIVERABLE: { label: 'Undeliverable', variant: 'outline', icon: XCircle },
  CANCELLED: { label: 'Cancelled', variant: 'outline', icon: XCircle },
}

export function statusPresentation(status: string): StatusPresentation {
  return MAP[status] ?? { label: status, variant: 'subtle', icon: Info }
}

const COURIER_LABELS: Record<string, string> = {
  POSTEX: 'PostEx',
  LEOPARDS: 'Leopards',
  TCS: 'TCS',
  MP: 'M&P',
  OTHER: 'Other',
}

export function courierLabel(courier: string): string {
  return COURIER_LABELS[courier] ?? courier
}

export function formatPkr(amount: number): string {
  return `PKR ${amount.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
