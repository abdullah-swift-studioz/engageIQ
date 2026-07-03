import * as React from 'react'
import { useOverlayBehavior } from '../ui/overlay-behavior'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

/**
 * AppShell — the fixed left Sidebar + Topbar + scrollable content region that
 * wraps every route. The sidebar is static on large screens and becomes a
 * modal slide-in drawer on mobile (focus-trapped via the shared overlay hook,
 * matching Modal/Drawer). Wired in `app/root.tsx` around <Outlet/>.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const drawerRef = React.useRef<HTMLDivElement>(null)

  // Scroll-lock + Escape + initial focus + Tab trap + focus restore.
  useOverlayBehavior(mobileOpen, () => setMobileOpen(false), drawerRef)

  return (
    <div className="min-h-screen bg-white">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-neutral-200 lg:block">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-neutral-950/40 animate-overlay-in"
            aria-hidden="true"
            onClick={() => setMobileOpen(false)}
          />
          <div
            ref={drawerRef}
            id="mobile-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 w-72 max-w-[82%] border-r border-neutral-200 bg-white animate-drawer-in-left focus:outline-none"
          >
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-h-screen flex-col lg:pl-60">
        <Topbar onMenuClick={() => setMobileOpen(true)} navOpen={mobileOpen} />
        <main className="flex-1">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
