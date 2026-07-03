import * as React from 'react'
import { cn } from './cn'
import { fieldBase, fieldBorder } from './field-styles'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Error state — renders a heavier/darker border (no hue). */
  invalid?: boolean
  /** Optional adornment inside the field, left side (e.g. a search icon). */
  startIcon?: React.ReactNode
  /** Optional adornment inside the field, right side. */
  endIcon?: React.ReactNode
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, startIcon, endIcon, className, type, 'aria-invalid': ariaInvalid, ...props },
  ref,
) {
  const isInvalid = invalid ?? (ariaInvalid === true || ariaInvalid === 'true')
  const input = (
    <input
      ref={ref}
      type={type ?? 'text'}
      aria-invalid={isInvalid || undefined}
      className={cn(
        fieldBase,
        fieldBorder(isInvalid),
        'h-9 px-3 py-1.5',
        startIcon && 'pl-9',
        endIcon && 'pr-9',
        className,
      )}
      {...props}
    />
  )

  if (!startIcon && !endIcon) return input

  return (
    <div className="relative">
      {startIcon && (
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-neutral-400 [&_svg]:size-4">
          {startIcon}
        </span>
      )}
      {input}
      {endIcon && (
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-neutral-400 [&_svg]:size-4">
          {endIcon}
        </span>
      )}
    </div>
  )
})
