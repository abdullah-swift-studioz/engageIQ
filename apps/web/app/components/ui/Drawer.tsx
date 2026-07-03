import * as React from 'react'
import { cn } from './cn'
import { X } from './icons'
import { useOverlayBehavior } from './overlay-behavior'

export type DrawerSide = 'right' | 'left'
export type DrawerSize = 'sm' | 'md' | 'lg'

const sizes: Record<DrawerSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-xl',
}

export interface DrawerProps {
  open: boolean
  onClose?: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  side?: DrawerSide
  size?: DrawerSize
  closeOnBackdrop?: boolean
  className?: string
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = 'right',
  size = 'md',
  closeOnBackdrop = true,
  className,
}: DrawerProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const reactId = React.useId()
  useOverlayBehavior(open, onClose, panelRef)

  if (!open) return null

  const titleId = title ? `${reactId}-title` : undefined
  const descId = description ? `${reactId}-desc` : undefined

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-neutral-950/40 animate-overlay-in"
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
          'absolute inset-y-0 flex w-full flex-col border-neutral-200 bg-white shadow-overlay focus:outline-none',
          sizes[size],
          side === 'right'
            ? 'right-0 border-l animate-drawer-in'
            : 'left-0 border-r animate-drawer-in-left',
          className,
        )}
      >
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
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 [&_svg]:size-4"
          >
            <X />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm text-neutral-700">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
