/**
 * EngageIQ charts — thin, monochrome SVG wrappers for the analytics pages.
 *
 * Grayscale only: series are separated by shade + dash, magnitude by a single
 * light→dark gray ramp. No colored series, ever. Each chart is responsive,
 * SSR-safe, and ships a hover tooltip by default.
 *
 *   import { BarChart, LineChart, Heatmap, Sparkline } from '~/components/charts'
 */
export { BarChart } from './BarChart'
export type { BarChartProps, BarDatum } from './BarChart'
export { LineChart } from './LineChart'
export type { LineChartProps, LineSeries } from './LineChart'
export { Heatmap } from './Heatmap'
export type { HeatmapProps } from './Heatmap'
export { Sparkline } from './Sparkline'
export type { SparklineProps } from './Sparkline'
export {
  SERIES_SHADES,
  SERIES_DASH,
  formatCompact,
  niceTicks,
  grayForValue,
} from './chart-utils'
