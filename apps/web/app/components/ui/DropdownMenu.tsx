import * as React from 'react'
import { cn } from './cn'

interface DropdownContextValue {
  open: boolean
  setOpen: (v: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement>
  contentId: string
}

const DropdownContext = React.createContext<DropdownContextValue | null>(null)

function useDropdown(component: string): DropdownContextValue {
  const ctx = React.useContext(DropdownContext)
  if (!ctx) throw new Error(`${component} must be used within <DropdownMenu>`)
  return ctx
}

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const contentId = React.useId()
  // Memoize so an ancestor re-render doesn't change context identity while the
  // menu is open (which would re-run the content effect and steal focus).
  const value = React.useMemo(
    () => ({ open, setOpen, triggerRef, contentId }),
    [open, contentId],
  )
  return (
    <DropdownContext.Provider value={value}>
      <div className="relative inline-block text-left">{children}</div>
    </DropdownContext.Provider>
  )
}

export interface DropdownMenuTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export function DropdownMenuTrigger({ children, onClick, ...props }: DropdownMenuTriggerProps) {
  const ctx = useDropdown('DropdownMenuTrigger')
  return (
    <button
      ref={ctx.triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={ctx.open}
      aria-controls={ctx.open ? ctx.contentId : undefined}
      onClick={(e) => {
        onClick?.(e)
        ctx.setOpen(!ctx.open)
      }}
      {...props}
    >
      {children}
    </button>
  )
}

export interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'end'
}

export function DropdownMenuContent({
  align = 'start',
  className,
  children,
  ...props
}: DropdownMenuContentProps) {
  const ctx = useDropdown('DropdownMenuContent')
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!ctx.open) return

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || ctx.triggerRef.current?.contains(target)) return
      ctx.setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        ctx.setOpen(false)
        ctx.triggerRef.current?.focus()
      }
    }

    const raf = requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
    })
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
    // Key off primitives, not the ctx object, so this only re-runs on open/close.
  }, [ctx.open, ctx.setOpen, ctx.triggerRef])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
    )
    if (items.length === 0) return
    const idx = items.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === 'ArrowDown'
        ? (idx + 1) % items.length
        : (idx - 1 + items.length) % items.length
    items[next < 0 ? 0 : next]?.focus()
  }

  if (!ctx.open) return null

  return (
    <div
      ref={ref}
      id={ctx.contentId}
      role="menu"
      onKeyDown={onKeyDown}
      className={cn(
        'absolute top-full z-40 mt-1.5 min-w-44 origin-top rounded-lg border border-neutral-200 bg-white p-1 shadow-overlay animate-scale-in',
        align === 'end' ? 'right-0' : 'left-0',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export interface DropdownMenuItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Close the menu after the item is chosen (default true). */
  closeOnSelect?: boolean
}

export function DropdownMenuItem({
  className,
  onClick,
  closeOnSelect = true,
  children,
  ...props
}: DropdownMenuItemProps) {
  const ctx = useDropdown('DropdownMenuItem')
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={(e) => {
        onClick?.(e)
        if (closeOnSelect) {
          ctx.setOpen(false)
          ctx.triggerRef.current?.focus()
        }
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus:bg-neutral-100 focus:text-neutral-950 focus:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:text-neutral-500',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function DropdownMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-2.5 py-1.5 text-2xs font-semibold uppercase tracking-wider text-neutral-400', className)}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="separator" className={cn('-mx-1 my-1 h-px bg-neutral-200', className)} {...props} />
}
