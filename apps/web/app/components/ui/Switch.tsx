import * as React from 'react'
import { cn } from './cn'

export interface SwitchProps {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  id?: string
  /** When set, renders a hidden input so the value posts with a form. */
  name?: string
  value?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  className?: string
}

export function Switch({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  id,
  name,
  value = 'on',
  className,
  ...aria
}: SwitchProps) {
  const isControlled = checked !== undefined
  const [internal, setInternal] = React.useState(Boolean(defaultChecked))
  const on = isControlled ? Boolean(checked) : internal

  const toggle = () => {
    if (disabled) return
    const next = !on
    if (!isControlled) setInternal(next)
    onCheckedChange?.(next)
  }

  return (
    <>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={on}
        disabled={disabled}
        onClick={toggle}
        className={cn(
          'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          on ? 'bg-neutral-950' : 'bg-neutral-300',
          className,
        )}
        {...aria}
      >
        <span
          className={cn(
            'pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm transition-transform',
            on ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
      {name && <input type="hidden" name={name} value={on ? value : ''} />}
    </>
  )
}
