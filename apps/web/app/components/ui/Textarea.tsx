import * as React from 'react'
import { cn } from './cn'
import { fieldBase, fieldBorder } from './field-styles'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Error state — renders a heavier/darker border (no hue). */
  invalid?: boolean
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, 'aria-invalid': ariaInvalid, ...props },
  ref,
) {
  const isInvalid = invalid ?? (ariaInvalid === true || ariaInvalid === 'true')
  return (
    <textarea
      ref={ref}
      aria-invalid={isInvalid || undefined}
      className={cn(fieldBase, fieldBorder(isInvalid), 'min-h-[84px] px-3 py-2 resize-y', className)}
      {...props}
    />
  )
})
