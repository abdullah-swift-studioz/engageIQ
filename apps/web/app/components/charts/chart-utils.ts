/**
 * Shared helpers for the monochrome chart wrappers. Pure + deterministic so
 * charts render identically on server and client (SSR-safe).
 *
 * There is NO color here on purpose. Series are separated by grayscale shade
 * and line dash; magnitude (heatmaps, sparklines) uses a single gray ramp
 * light→dark, per the sequential rule. Never introduce a hue.
 */

/** Grayscale series shades (dark→light) — used in fixed order, never cycled arbitrarily. */
export const SERIES_SHADES = ['#0A0A0A', '#737373', '#A3A3A3'] as const
/** Matching dash arrays so series stay distinguishable without color. */
export const SERIES_DASH = ['', '6 4', '2 3'] as const

export const AXIS_COLOR = '#E5E5E5' // recessive gridlines / axis
export const AXIS_TEXT = '#737373'

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

/** Default compact number formatter (1.2k, 3.4M). */
export function formatCompact(n: number): string {
  if (!isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`
  return `${Math.round(n * 100) / 100}`
}

/** A "nice" axis maximum and evenly-spaced ticks from 0. */
export function niceTicks(maxValue: number, targetCount = 4): { max: number; ticks: number[] } {
  if (!isFinite(maxValue) || maxValue <= 0) return { max: 1, ticks: [0, 1] }
  const rough = maxValue / targetCount
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const norm = rough / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  const niceMax = Math.ceil(maxValue / step) * step
  const ticks: number[] = []
  for (let t = 0; t <= niceMax + step / 2; t += step) ticks.push(Math.round(t * 1000) / 1000)
  return { max: niceMax, ticks }
}

/** SVG path for a rectangle with only its TOP two corners rounded. */
export function roundedTopRect(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, w / 2, h))
  if (radius === 0) return `M${x},${y}h${w}v${h}h${-w}z`
  return [
    `M${x},${y + h}`,
    `V${y + radius}`,
    `q0,${-radius} ${radius},${-radius}`,
    `h${w - radius * 2}`,
    `q${radius},0 ${radius},${radius}`,
    `V${y + h}`,
    'z',
  ].join(' ')
}

/** SVG polyline `d` from an array of points. */
export function linePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
}

/** Grayscale fill for a normalized magnitude t∈[0,1] — light (t=0) → dark (t=1). */
export function grayForValue(t: number, opts?: { light?: number; dark?: number }): string {
  const light = opts?.light ?? 245 // #F5F5F5
  const dark = opts?.dark ?? 23 // #171717
  const c = Math.round(light + (dark - light) * clamp(t, 0, 1))
  return `rgb(${c}, ${c}, ${c})`
}

/** Whether text on a grayscale magnitude cell should be light (cell is dark). */
export function isDarkCell(t: number): boolean {
  return clamp(t, 0, 1) > 0.55
}
