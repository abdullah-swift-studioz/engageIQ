import * as React from 'react'
import { cn } from './cn'

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  /** Primary call-to-action; an empty screen is an invitation to act. */
  action?: React.ReactNode
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50/60 px-6 py-14 text-center',
        className,
      )}
      {...props}
    >
      {icon && (
        <div className="mb-4 flex size-11 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-neutral-950">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-neutral-500">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
