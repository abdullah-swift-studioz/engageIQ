import * as React from 'react'
import { cn } from './cn'
import { X } from './icons'
import { useOverlayBehavior } from './overlay-behavior'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

const sizes: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

export interface ModalProps {
  open: boolean
  onClose?: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  /** Right-aligned footer actions. */
  footer?: React.ReactNode
  size?: ModalSize
  /** Close when the backdrop is clicked (default true). */
  closeOnBackdrop?: boolean
  /** Hide the top-right close button. */
  hideClose?: boolean
  className?: string
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  hideClose,
  className,
}: ModalProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const reactId = React.useId()
  useOverlayBehavior(open, onClose, panelRef)

  if (!open) return null

  const titleId = title ? `${reactId}-title` : undefined
  const descId = description ? `${reactId}-desc` : undefined

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div
        className="fixed inset-0 bg-neutral-950/40 animate-overlay-in"
        aria-hidden="true"
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className={cn(
          'relative z-10 my-auto w-full rounded-xl border border-neutral-200 bg-white shadow-overlay animate-scale-in focus:outline-none',
          sizes[size],
          className,
        )}
      >
        {(title || description || !hideClose) && (
          <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
            <div className="min-w-0">
              {title && (
                <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-950">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="mt-1 text-sm text-neutral-500">
                  {description}
                </p>
              )}
            </div>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 [&_svg]:size-4"
              >
                <X />
              </button>
            )}
          </div>
        )}

        {children && <div className="px-5 py-4 text-sm text-neutral-700">{children}</div>}

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
