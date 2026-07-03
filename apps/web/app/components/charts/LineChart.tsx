import * as React from 'react'
import { cn } from '../ui/cn'
import {
  AXIS_COLOR,
  AXIS_TEXT,
  SERIES_DASH,
  SERIES_SHADES,
  clamp,
  formatCompact,
  linePath,
  niceTicks,
} from './chart-utils'
import { useChartWidth } from './use-chart-width'

export interface LineSeries {
  name: string
  values: number[]
}

export interface LineChartProps {
  /** X-axis category labels (shared across series). */
  labels: string[]
  /** 1–3 series recommended; separated by shade + dash, never color. */
  series: LineSeries[]
  height?: number
  valueFormatter?: (v: number) => string
  /** Fill a faint area under the first series. */
  showArea?: boolean
  ariaLabel?: string
  className?: string
}

const PAD = { top: 14, right: 16, bottom: 30, left: 46 }

/** Multi-series line chart in grayscale with a hover crosshair + tooltip. */
export function LineChart({
  labels,
  series,
  height = 240,
  valueFormatter = formatCompact,
  showArea,
  ariaLabel,
  className,
}: LineChartProps) {
  const [ref, W] = useChartWidth()
  const svgRef = React.useRef<SVGSVGElement>(null)
  const [hover, setHover] = React.useState<number | null>(null)

  const H = height
  const pw = Math.max(W - PAD.left - PAD.right, 0)
  const ph = H - PAD.top - PAD.bottom
  const n = labels.length
  const maxValue = series.reduce((m, s) => Math.max(m, ...s.values), 0)
  const { max, ticks } = niceTicks(maxValue)
  const step = n > 1 ? pw / (n - 1) : 0

  const x = (i: number) => PAD.left + (n > 1 ? i * step : pw / 2)
  const y = (v: number) => PAD.top + ph * (1 - v / max)

  const onMove = (e: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || n === 0) return
    const relX = ((e.clientX - rect.left) / rect.width) * W
    const idx = n > 1 ? Math.round((relX - PAD.left) / step) : 0
    setHover(clamp(idx, 0, n - 1))
  }

  const showLegend = series.length >= 2
  const tipLeft = hover != null ? (x(hover) / W) * 100 : 0

  return (
    <figure ref={ref} className={cn('relative w-full', className)}>
      {showLegend && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((s, i) => (
            <span key={s.name} className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
              <svg width={18} height={8} aria-hidden="true">
                <line
                  x1={0}
                  y1={4}
                  x2={18}
                  y2={4}
                  stroke={SERIES_SHADES[i % SERIES_SHADES.length]}
                  strokeWidth={2}
                  strokeDasharray={SERIES_DASH[i % SERIES_DASH.length] || undefined}
                />
              </svg>
              {s.name}
            </span>
          ))}
        </div>
      )}

      <svg
        ref={svgRef}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel ?? 'Line chart'}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
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

        {/* x labels — thinned to avoid collisions */}
        {labels.map((label, i) => {
          const every = Math.ceil(n / 8)
          if (i % every !== 0 && i !== n - 1) return null
          return (
            <text key={`${label}-${i}`} x={x(i)} y={H - PAD.bottom + 16} textAnchor="middle" fontSize={11} fill={AXIS_TEXT}>
              {label}
            </text>
          )
        })}

        {showArea && series[0] && (
          <path
            d={`${linePath(series[0].values.map((v, i) => ({ x: x(i), y: y(v) })))} L${x(n - 1)},${PAD.top + ph} L${x(0)},${PAD.top + ph} Z`}
            fill="#0A0A0A"
            fillOpacity={0.06}
          />
        )}

        {series.map((s, si) => (
          <path
            key={s.name}
            d={linePath(s.values.map((v, i) => ({ x: x(i), y: y(v) })))}
            fill="none"
            stroke={SERIES_SHADES[si % SERIES_SHADES.length]}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={SERIES_DASH[si % SERIES_DASH.length] || undefined}
          />
        ))}

        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ph} stroke="#0A0A0A" strokeWidth={1} strokeDasharray="3 3" />
            {series.map((s, si) => (
              <circle
                key={s.name}
                cx={x(hover)}
                cy={y(s.values[hover] ?? 0)}
                r={3.5}
                fill="#FFFFFF"
                stroke={SERIES_SHADES[si % SERIES_SHADES.length]}
                strokeWidth={2}
              />
            ))}
          </>
        )}
      </svg>

      {hover != null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs shadow-md"
          style={{ left: `${clamp(tipLeft, 8, 92)}%` }}
        >
          <p className="mb-1 font-medium text-neutral-500">{labels[hover]}</p>
          <div className="space-y-0.5">
            {series.map((s, si) => (
              <div key={s.name} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-neutral-600">
                  <svg width={12} height={6} aria-hidden="true">
                    <line
                      x1={0}
                      y1={3}
                      x2={12}
                      y2={3}
                      stroke={SERIES_SHADES[si % SERIES_SHADES.length]}
                      strokeWidth={2}
                      strokeDasharray={SERIES_DASH[si % SERIES_DASH.length] || undefined}
                    />
                  </svg>
                  {s.name}
                </span>
                <span className="tabular font-semibold text-neutral-950">
                  {valueFormatter(s.values[hover] ?? 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </figure>
  )
}
