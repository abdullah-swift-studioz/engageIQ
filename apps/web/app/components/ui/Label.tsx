import * as React from 'react'
import { cn } from './cn'

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Appends a subtle required marker (no hue). */
  required?: boolean
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { required, children, className, ...props },
  ref,
) {
  return (
    <label
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 text-sm font-medium text-neutral-800 select-none',
        className,
      )}
      {...props}
    >
      {children}
      {required && (
        <span className="text-neutral-400" aria-hidden="true">
          *
        </span>
      )}
    </label>
  )
})
