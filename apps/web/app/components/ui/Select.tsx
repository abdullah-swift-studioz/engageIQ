import * as React from 'react'
import { cn } from './cn'
import { fieldBase, fieldBorder } from './field-styles'
import { ChevronDown } from './icons'

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Error state — renders a heavier/darker border (no hue). */
  invalid?: boolean
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, 'aria-invalid': ariaInvalid, ...props },
  ref,
) {
  const isInvalid = invalid ?? (ariaInvalid === true || ariaInvalid === 'true')
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={isInvalid || undefined}
        className={cn(
          fieldBase,
          fieldBorder(isInvalid),
          'h-9 cursor-pointer appearance-none pl-3 pr-9',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-neutral-500" />
    </div>
  )
})
