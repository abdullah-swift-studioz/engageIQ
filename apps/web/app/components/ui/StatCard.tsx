import * as React from 'react'
import { cn } from './cn'
import { ArrowUpRight, ArrowDownRight } from './icons'

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Small uppercase eyebrow label — the system's data-label motif. */
  label: React.ReactNode
  value: React.ReactNode
  /** Secondary line under the value (e.g. "vs last week"). */
  sub?: React.ReactNode
  /** Change indicator — shown with a direction arrow + weight, never a hue. */
  delta?: { value: React.ReactNode; direction?: 'up' | 'down' }
  /** Optional leading icon, top-right of the tile. */
  icon?: React.ReactNode
  /** Optional trailing visual (e.g. a <Sparkline/>). */
  chart?: React.ReactNode
}

export function StatCard({
  label,
  value,
  sub,
  delta,
  icon,
  chart,
  className,
  ...props
}: StatCardProps) {
  const DeltaArrow = delta?.direction === 'down' ? ArrowDownRight : ArrowUpRight
  return (
    <div
      className={cn('rounded-lg border border-neutral-200 bg-white p-5 shadow-xs', className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xs font-medium uppercase tracking-wider text-neutral-500">{label}</p>
        {icon && <span className="text-neutral-400 [&_svg]:size-4">{icon}</span>}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="tabular text-2xl font-semibold tracking-tight text-neutral-950">{value}</p>
        {chart && <div className="shrink-0">{chart}</div>}
      </div>
      {(sub || delta) && (
        <div className="mt-1.5 flex items-center gap-2">
          {delta && (
            <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-neutral-950 [&_svg]:size-3.5">
              <DeltaArrow />
              {delta.value}
            </span>
          )}
          {sub && <span className="text-xs text-neutral-500">{sub}</span>}
        </div>
      )}
    </div>
  )
}
