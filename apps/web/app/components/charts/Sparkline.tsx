import * as React from 'react'
import { cn } from '../ui/cn'
import { linePath } from './chart-utils'

export interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  /** Faint area fill under the line. */
  area?: boolean
  /** Emphasize the last data point with a dot. */
  showLast?: boolean
  ariaLabel?: string
  className?: string
}

/** Tiny inline trend line (no axes) — for StatCard tiles and dense tables. */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  area,
  showLast,
  ariaLabel,
  className,
}: SparklineProps) {
  if (values.length === 0) return null
  const pad = 2
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0

  const pts = values.map((v, i) => ({
    x: pad + i * stepX,
    y: pad + (height - pad * 2) * (1 - (v - min) / span),
  }))
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (!first || !last) return null

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      role="img"
      aria-label={ariaLabel ?? 'Trend'}
    >
      {area && (
        <path
          d={`${linePath(pts)} L${last.x},${height - pad} L${first.x},${height - pad} Z`}
          fill="#0A0A0A"
          fillOpacity={0.07}
        />
      )}
      <path d={linePath(pts)} fill="none" stroke="#0A0A0A" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      {showLast && <circle cx={last.x} cy={last.y} r={2} fill="#0A0A0A" />}
    </svg>
  )
}
