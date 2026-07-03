import * as React from 'react'
import { cn } from './cn'

export interface RadioProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {}

export const Radio = React.forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { className, ...props },
  ref,
) {
  return (
    <span className={cn('relative inline-flex size-4 shrink-0 align-middle', className)}>
      <input
        ref={ref}
        type="radio"
        className="peer size-4 cursor-pointer appearance-none rounded-full border border-neutral-400 bg-white transition-colors checked:border-neutral-950 hover:border-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      />
      <span className="pointer-events-none absolute inset-0 m-auto size-2 rounded-full bg-neutral-950 opacity-0 peer-checked:opacity-100" />
    </span>
  )
})
