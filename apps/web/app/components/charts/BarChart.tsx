import * as React from 'react'
import { cn } from '../ui/cn'
import { AXIS_COLOR, AXIS_TEXT, formatCompact, niceTicks, roundedTopRect } from './chart-utils'
import { useChartWidth } from './use-chart-width'

export interface BarDatum {
  label: string
  value: number
}

export interface BarChartProps {
  data: BarDatum[]
  /** Pixel height of the chart (width is fluid). Default 240. */
  height?: number
  valueFormatter?: (v: number) => string
  /** Print each bar's value above it. */
  showValues?: boolean
  /** Accessible description of the chart. */
  ariaLabel?: string
  className?: string
}

const PAD = { top: 14, right: 12, bottom: 30, left: 46 }

/** Single-series vertical bars in grayscale. Recessive axes, rounded bar tops. */
export function BarChart({
  data,
  height = 240,
  valueFormatter = formatCompact,
  showValues,
  ariaLabel,
  className,
}: BarChartProps) {
  const [ref, W] = useChartWidth()
  const [hover, setHover] = React.useState<number | null>(null)

  const H = height
  const pw = Math.max(W - PAD.left - PAD.right, 0)
  const ph = H - PAD.top - PAD.bottom
  const maxValue = data.reduce((m, d) => Math.max(m, d.value), 0)
  const { max, ticks } = niceTicks(maxValue)
  const band = data.length > 0 ? pw / data.length : pw
  const barWidth = Math.min(band * 0.6, 56)

  const x = (i: number) => PAD.left + i * band + (band - barWidth) / 2
  const y = (v: number) => PAD.top + ph * (1 - v / max)

  const active = hover != null ? data[hover] : null
  const tipLeft = hover != null ? ((x(hover) + barWidth / 2) / W) * 100 : 0
  const tipTop = active ? (y(active.value) / H) * 100 : 0

  return (
    <figure ref={ref} className={cn('relative w-full', className)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel ?? 'Bar chart'}>
        {ticks.map((t) => {
          const gy = y(t)
          return (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={gy} y2={gy} stroke={AXIS_COLOR} strokeWidth={1} />
              <text x={PAD.left - 8} y={gy} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={AXIS_TEXT}>
                {valueFormatter(t)}
              </text>
            </g>
          )
        })}

        {data.map((d, i) => {
          const by = y(d.value)
          const bh = PAD.top + ph - by
          const isActive = hover === i
          return (
            <g key={`${d.label}-${i}`}>
              <path
                d={roundedTopRect(x(i), by, barWidth, bh, 4)}
                fill={isActive ? '#0A0A0A' : '#404040'}
                className="transition-[fill] duration-150"
              />
              <rect
                x={PAD.left + i * band}
                y={PAD.top}
                width={band}
                height={ph}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              />
              {showValues && (
                <text x={x(i) + barWidth / 2} y={by - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="#0A0A0A">
                  {valueFormatter(d.value)}
                </text>
              )}
              <text x={x(i) + barWidth / 2} y={H - PAD.bottom + 16} textAnchor="middle" fontSize={11} fill={AXIS_TEXT}>
                {d.label}
              </text>
            </g>
          )
        })}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs shadow-md"
          style={{ left: `${tipLeft}%`, top: `calc(${tipTop}% - 8px)` }}
        >
          <span className="font-medium text-neutral-500">{active.label}: </span>
          <span className="tabular font-semibold text-neutral-950">{valueFormatter(active.value)}</span>
        </div>
      )}
    </figure>
  )
}
