import * as React from 'react'
import { cn } from '../ui/cn'

/**
 * EngageIQ logomark — a monochrome "engagement pulse" glyph in a near-black
 * rounded square. The pulse (a signal that rises) is the system's brand
 * signature; it recurs nowhere else, so it stays memorable.
 */
export function Logomark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-neutral-950 text-white',
        className,
      )}
      aria-hidden="true"
    >
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 13h3l2.5-7 4 14 2.5-8 1.5 4H21" />
      </svg>
    </span>
  )
}

/** Full wordmark: logomark + "EngageIQ", with the "IQ" set in a muted tone. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Logomark />
      <span className="text-[15px] font-semibold tracking-tight text-neutral-950">
        Engage<span className="text-neutral-400">IQ</span>
      </span>
    </span>
  )
}
