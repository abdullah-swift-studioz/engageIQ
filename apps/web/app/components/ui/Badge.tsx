import * as React from 'react'
import { cn } from './cn'
import { X } from './icons'

export type BadgeVariant = 'solid' | 'outline' | 'subtle'
export type BadgeSize = 'sm' | 'md'

const variants: Record<BadgeVariant, string> = {
  solid: 'bg-neutral-950 text-white',
  outline: 'border border-neutral-300 text-neutral-700',
  subtle: 'bg-neutral-100 text-neutral-700',
}

const sizes: Record<BadgeSize, string> = {
  sm: 'h-5 px-1.5 text-2xs',
  md: 'h-6 px-2 text-xs',
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  size?: BadgeSize
  /** Prepends a small status dot (filled = solid/subtle, hollow = outline). */
  dot?: boolean
  /** Renders a remove button (for filter tags). */
  onRemove?: () => void
}

export function Badge({
  variant = 'subtle',
  size = 'md',
  dot,
  onRemove,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            'size-1.5 rounded-full',
            variant === 'outline' ? 'border border-current' : 'bg-current',
          )}
          aria-hidden="true"
        />
      )}
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="-mr-0.5 inline-flex size-3.5 items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current [&_svg]:size-2.5"
        >
          <X />
        </button>
      )}
    </span>
  )
}

/** `Tag` is an alias of `Badge` — same component, clearer name for filter chips. */
export const Tag = Badge
