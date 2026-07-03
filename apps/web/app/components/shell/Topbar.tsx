import * as React from 'react'
import { useNavigate } from '@remix-run/react'
import { cn } from '../ui/cn'
import { Input } from '../ui/Input'
import { Avatar } from '../ui/Avatar'
import { Tooltip } from '../ui/Tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '../ui/DropdownMenu'
import { Menu, Search, Bell, ChevronDown } from '../ui/icons'
import { Wordmark } from './Logomark'

const iconButton =
  'inline-flex size-9 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2'

export function Topbar({ onMenuClick, navOpen }: { onMenuClick: () => void; navOpen: boolean }) {
  const navigate = useNavigate()

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-neutral-200 bg-white/85 px-4 backdrop-blur">
      <button
        type="button"
        onClick={onMenuClick}
        className={cn(iconButton, 'lg:hidden')}
        aria-label="Open navigation"
        aria-expanded={navOpen}
        aria-controls="mobile-nav-drawer"
      >
        <Menu className="size-5" />
      </button>

      <div className="lg:hidden">
        <Wordmark />
      </div>

      {/* Global search → customers list. */}
      <form action="/customers" method="get" className="hidden max-w-sm flex-1 sm:block">
        <Input
          type="search"
          name="q"
          placeholder="Search customers…"
          startIcon={<Search />}
          aria-label="Search customers"
        />
      </form>

      <div className="ml-auto flex items-center gap-1">
        <Tooltip content="Notifications">
          <button type="button" className={iconButton} aria-label="Notifications">
            <Bell className="size-[18px]" />
          </button>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center gap-1.5 rounded-md p-1 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
            aria-label="Account menu"
          >
            <Avatar name="Abdullah Ali" size="sm" />
            <ChevronDown className="hidden size-4 text-neutral-400 sm:block" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuLabel>Signed in</DropdownMenuLabel>
            <div className="px-2.5 pb-1.5">
              <p className="text-sm font-medium text-neutral-900">Abdullah Ali</p>
              <p className="truncate text-xs text-neutral-500">Swift Studioz</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/settings')}>Settings &amp; RBAC</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/analytics')}>Analytics</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
