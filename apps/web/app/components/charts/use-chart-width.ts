import * as React from 'react'

/**
 * Measures a container's width so charts can render at 1:1 coordinates (crisp
 * text + strokes, no viewBox distortion). SSR renders at `fallback`; a
 * ResizeObserver updates after mount and on resize.
 */
export function useChartWidth(fallback = 640): [React.RefObject<HTMLDivElement>, number] {
  const ref = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(fallback)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth || fallback)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fallback])

  return [ref, width]
}
