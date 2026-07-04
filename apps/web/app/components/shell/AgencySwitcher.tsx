import * as React from 'react'
import { useFetcher, useLocation } from '@remix-run/react'
import type { AgencyContext } from '@engageiq/shared'
import { cn } from '../ui/cn'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '../ui/DropdownMenu'
import { Check, ChevronDown, AppWindow } from '../ui/icons'

/**
 * Agency account switcher (guide §9.4). Renders in the Topbar for agency users
 * only. Loads the agency context from the /api/agency resource route, lists the
 * accessible client accounts, and switches the active one (persisted in a cookie
 * that every apiFetch forwards as x-acting-merchant-id).
 */
export function AgencySwitcher() {
  const ctxFetcher = useFetcher<{ context: AgencyContext | null }>()
  const switchFetcher = useFetcher()
  const location = useLocation()

  // Load the context once on mount (client-side only).
  React.useEffect(() => {
    if (ctxFetcher.state === 'idle' && !ctxFetcher.data) ctxFetcher.load('/api/agency')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const context = ctxFetcher.data?.context
  // Only agencies with more than just their home account get a switcher.
  if (!context || !context.isAgency || context.accessibleMerchants.length <= 1) return null

  const active =
    context.accessibleMerchants.find((m) => m.id === context.activeMerchantId) ??
    context.accessibleMerchants[0]

  function switchTo(merchantId: string, isHome: boolean) {
    switchFetcher.submit(
      { merchantId: isHome ? '__home__' : merchantId, redirectTo: location.pathname },
      { method: 'post', action: '/api/agency' },
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
        aria-label="Switch client account"
      >
        <AppWindow className="size-4 text-neutral-500" />
        <span className="max-w-[9rem] truncate">{active?.name ?? 'Account'}</span>
        <ChevronDown className="size-4 text-neutral-400" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        <DropdownMenuLabel>Client accounts</DropdownMenuLabel>
        {context.accessibleMerchants.map((m, i) => {
          const isActive = m.id === context.activeMerchantId
          return (
            <React.Fragment key={m.id}>
              {i === 1 && <DropdownMenuSeparator />}
              <DropdownMenuItem onClick={() => switchTo(m.id, m.isHome)}>
                <span className="flex w-full items-center gap-2">
                  <Check
                    className={cn('size-4 shrink-0', isActive ? 'text-neutral-950' : 'text-transparent')}
                  />
                  <span className="flex-1 truncate">
                    {m.name}
                    {m.isHome && <span className="ml-1 text-xs text-neutral-400">(agency)</span>}
                  </span>
                </span>
              </DropdownMenuItem>
            </React.Fragment>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
