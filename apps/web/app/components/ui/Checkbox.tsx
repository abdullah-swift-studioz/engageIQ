import * as React from 'react'
import { cn } from './cn'
import { Check, Minus } from './icons'

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Tri-state: renders a dash and sets the DOM `indeterminate` property. */
  indeterminate?: boolean
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { indeterminate, className, ...props },
  ref,
) {
  const innerRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = Boolean(indeterminate)
  }, [indeterminate])

  const setRef = React.useCallback(
    (node: HTMLInputElement | null) => {
      innerRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node
    },
    [ref],
  )

  return (
    <span className={cn('relative inline-flex size-4 shrink-0 align-middle', className)}>
      <input
        ref={setRef}
        type="checkbox"
        className="peer size-4 cursor-pointer appearance-none rounded-[4px] border border-neutral-400 bg-white transition-colors checked:border-neutral-950 checked:bg-neutral-950 indeterminate:border-neutral-950 indeterminate:bg-neutral-950 hover:border-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      />
      <Check className="pointer-events-none absolute inset-0 m-auto size-3 text-white opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-0" />
      <Minus className="pointer-events-none absolute inset-0 m-auto size-3 text-white opacity-0 peer-indeterminate:opacity-100" />
    </span>
  )
})
