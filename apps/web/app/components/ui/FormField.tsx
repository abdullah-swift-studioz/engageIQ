import * as React from 'react'
import { cn } from './cn'
import { Label } from './Label'
import { AlertCircle } from './icons'

export interface FormFieldProps {
  label?: React.ReactNode
  /** Explicit id for the control; auto-generated if omitted. */
  id?: string
  hint?: React.ReactNode
  /** When set, the field renders in its error state (message + darker border). */
  error?: React.ReactNode
  required?: boolean
  className?: string
  children: React.ReactNode
}

/**
 * FormField wires a Label, control, and a hint/error message together and
 * links them for assistive tech. It injects `id`, `aria-invalid`, and
 * `aria-describedby` onto its single child control (our Input/Select/Textarea
 * read `aria-invalid` for their error styling — so no hue is needed).
 */
export function FormField({
  label,
  id,
  hint,
  error,
  required,
  className,
  children,
}: FormFieldProps) {
  const reactId = React.useId()

  // Prefer an id the child already carries, so the <label> always points at the
  // real control; otherwise use the caller's id, else a generated one.
  const childId =
    React.isValidElement(children) &&
    typeof (children.props as Record<string, unknown>).id === 'string'
      ? ((children.props as Record<string, unknown>).id as string)
      : undefined
  const fieldId = childId ?? id ?? reactId
  const hintId = `${fieldId}-hint`
  const errorId = `${fieldId}-error`

  const describedBy =
    [error ? errorId : null, !error && hint ? hintId : null].filter(Boolean).join(' ') || undefined

  let control = children
  if (React.isValidElement(children)) {
    const childProps = children.props as Record<string, unknown>
    const extra: Record<string, unknown> = { id: fieldId }
    if (error) extra['aria-invalid'] = true
    if (describedBy) extra['aria-describedby'] = describedBy
    if (required && childProps['aria-required'] === undefined && childProps.required === undefined) {
      extra['aria-required'] = true
    }
    control = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, extra)
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <Label htmlFor={fieldId} required={required}>
          {label}
        </Label>
      )}
      {control}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-neutral-950">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-neutral-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
