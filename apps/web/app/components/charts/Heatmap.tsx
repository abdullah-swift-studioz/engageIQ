import * as React from 'react'
import { cn } from '../ui/cn'
import { AXIS_TEXT, formatCompact, grayForValue, isDarkCell } from './chart-utils'
import { useChartWidth } from './use-chart-width'

export interface HeatmapProps {
  rowLabels: string[]
  colLabels: string[]
  /** values[row][col]; use null for an absent cell. */
  values: Array<Array<number | null>>
  /** Scale ceiling (defaults to the max present value). */
  max?: number
  valueFormatter?: (v: number) => string
  /** Show the numeric value inside each cell. */
  showValues?: boolean
  ariaLabel?: string
  className?: string
}

const ROW_LABEL_W = 96
const COL_LABEL_H = 26
const CELL_H = 34
const GAP = 2

/** Grayscale sequential heatmap (light→dark). For cohort retention, density, etc. */
export function Heatmap({
  rowLabels,
  colLabels,
  values,
  max,
  valueFormatter = formatCompact,
  showValues = true,
  ariaLabel,
  className,
}: HeatmapProps) {
  const [ref, W] = useChartWidth()
  const [hover, setHover] = React.useState<{ r: number; c: number } | null>(null)

  const cols = colLabels.length
  const cellW = cols > 0 ? Math.max((W - ROW_LABEL_W) / cols, 0) : 0
  const H = COL_LABEL_H + rowLabels.length * CELL_H

  const presentMax = values.reduce<number>(
    (m, row) => row.reduce<number>((mm, v) => (v == null ? mm : Math.max(mm, v)), m),
    0,
  )
  const computedMax = max ?? (presentMax > 0 ? presentMax : 1)

  const active = hover ? values[hover.r]?.[hover.c] : undefined

  return (
    <figure ref={ref} className={cn('relative w-full', className)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel ?? 'Heatmap'}>
        {colLabels.map((label, c) => (
          <text
            key={`c-${c}`}
            x={ROW_LABEL_W + c * cellW + cellW / 2}
            y={COL_LABEL_H - 9}
            textAnchor="middle"
            fontSize={11}
            fill={AXIS_TEXT}
          >
            {label}
          </text>
        ))}

        {rowLabels.map((rLabel, r) => (
          <g key={`r-${r}`}>
            <text
              x={ROW_LABEL_W - 10}
              y={COL_LABEL_H + r * CELL_H + CELL_H / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill={AXIS_TEXT}
            >
              {rLabel}
            </text>
            {colLabels.map((_, c) => {
              const v = values[r]?.[c]
              const cx = ROW_LABEL_W + c * cellW
              const cy = COL_LABEL_H + r * CELL_H
              const t = v == null ? 0 : v / computedMax
              const isActive = hover?.r === r && hover?.c === c
              return (
                <g key={`cell-${r}-${c}`}>
                  <rect
                    x={cx + GAP / 2}
                    y={cy + GAP / 2}
                    width={Math.max(cellW - GAP, 0)}
                    height={CELL_H - GAP}
                    rx={3}
                    fill={v == null ? '#FFFFFF' : grayForValue(t)}
                    stroke={v == null ? '#E5E5E5' : isActive ? '#0A0A0A' : 'transparent'}
                    strokeWidth={isActive ? 2 : 1}
                    onMouseEnter={() => setHover({ r, c })}
                    onMouseLeave={() => setHover((h) => (h?.r === r && h?.c === c ? null : h))}
                  />
                  {showValues && v != null && cellW >= 34 && (
                    <text
                      x={cx + cellW / 2}
                      y={cy + CELL_H / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={11}
                      fontWeight={500}
                      fill={isDarkCell(t) ? '#FFFFFF' : '#404040'}
                      pointerEvents="none"
                    >
                      {valueFormatter(v)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        ))}
      </svg>

      {hover && active != null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs shadow-md"
          style={{
            left: `${((ROW_LABEL_W + hover.c * cellW + cellW / 2) / W) * 100}%`,
            top: `${((COL_LABEL_H + hover.r * CELL_H) / H) * 100}%`,
          }}
        >
          <span className="font-medium text-neutral-500">
            {rowLabels[hover.r]} · {colLabels[hover.c]}:{' '}
          </span>
          <span className="tabular font-semibold text-neutral-950">{valueFormatter(active)}</span>
        </div>
      )}
    </figure>
  )
}
