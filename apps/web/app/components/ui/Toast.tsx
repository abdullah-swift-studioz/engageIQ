import * as React from 'react'
import { cn } from './cn'
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from './icons'

export type ToastVariant = 'default' | 'success' | 'error' | 'warning'

export interface ToastOptions {
  title: React.ReactNode
  description?: React.ReactNode
  /** State is signalled by an icon + weight, never color. */
  variant?: ToastVariant
  /** Auto-dismiss delay in ms; 0 keeps it until dismissed. Default 5000. */
  duration?: number
  action?: React.ReactNode
}

interface ToastRecord extends ToastOptions {
  id: number
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => number
  dismiss: (id: number) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

const icons: Record<ToastVariant, React.ReactNode | null> = {
  default: null,
  success: <CheckCircle />,
  error: <AlertCircle />,
  warning: <AlertTriangle />,
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([])
  const counter = React.useRef(0)
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const toast = React.useCallback(
    (opts: ToastOptions) => {
      counter.current += 1
      const id = counter.current
      setToasts((prev) => [...prev, { ...opts, id }])
      const duration = opts.duration ?? 5000
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        )
      }
      return id
    },
    [dismiss],
  )

  React.useEffect(() => {
    const map = timers.current
    return () => map.forEach((t) => clearTimeout(t))
  }, [])

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed bottom-0 right-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} record={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ record, onClose }: { record: ToastRecord; onClose: () => void }) {
  const icon = icons[record.variant ?? 'default']
  return (
    <div
      role="status"
      className="pointer-events-auto flex items-start gap-3 rounded-lg border border-neutral-200 bg-white p-3.5 shadow-overlay animate-toast-in"
    >
      {icon && <span className="mt-0.5 shrink-0 text-neutral-950 [&_svg]:size-[18px]">{icon}</span>}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-neutral-950">{record.title}</p>
        {record.description && (
          <p className="mt-0.5 text-sm text-neutral-500">{record.description}</p>
        )}
        {record.action && <div className="mt-2">{record.action}</div>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 [&_svg]:size-3.5"
      >
        <X />
      </button>
    </div>
  )
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

/** Small helper for the (rare) case a component needs the raw Info icon. */
export const ToastInfoIcon = Info
