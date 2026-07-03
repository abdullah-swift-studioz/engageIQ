import * as React from 'react'
import { cn } from './cn'

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

const positions: Record<TooltipSide, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
}

export interface TooltipProps {
  content: React.ReactNode
  side?: TooltipSide
  /** Hover-open delay in ms (default 200). */
  delay?: number
  children: React.ReactNode
  className?: string
}

/** Shows on hover and keyboard focus; hides on Escape, blur, or pointer-leave. */
export function Tooltip({ content, side = 'top', delay = 200, children, className }: TooltipProps) {
  const [open, setOpen] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = React.useId()

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
  }
  const show = () => {
    clear()
    timer.current = setTimeout(() => setOpen(true), delay)
  }
  const hide = () => {
    clear()
    setOpen(false)
  }

  React.useEffect(() => clear, [])

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape') hide()
      }}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && content ? (
        <span
          role="tooltip"
          id={id}
          className={cn(
            'pointer-events-none absolute z-50 max-w-xs whitespace-nowrap rounded-md bg-neutral-950 px-2 py-1 text-xs font-medium text-white shadow-md animate-fade-in',
            positions[side],
            className,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  )
}
