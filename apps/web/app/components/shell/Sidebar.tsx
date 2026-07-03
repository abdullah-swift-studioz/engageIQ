import * as React from 'react'
import { NavLink, useLocation } from '@remix-run/react'
import { cn } from '../ui/cn'
import { Badge } from '../ui/Badge'
import { Avatar } from '../ui/Avatar'
import { Wordmark } from './Logomark'
import { NAV, type NavItem, type NavLeaf } from './nav'

function LeafLink({
  leaf,
  onNavigate,
  nested,
}: {
  leaf: NavLeaf
  onNavigate?: () => void
  nested?: boolean
}) {
  return (
    <NavLink
      to={leaf.to}
      end={leaf.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'block rounded-md py-1.5 pl-3 pr-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950',
          nested && 'ml-[26px] border-l border-neutral-200',
          isActive
            ? 'font-medium text-neutral-950'
            : 'text-neutral-500 hover:text-neutral-950',
        )
      }
    >
      {leaf.label}
    </NavLink>
  )
}

function ItemLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950',
          isActive
            ? 'bg-neutral-100 font-medium text-neutral-950'
            : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-neutral-950"
              aria-hidden="true"
            />
          )}
          <item.icon className="size-4 shrink-0" />
          <span className="flex-1 truncate">{item.label}</span>
          {item.soon && (
            <Badge size="sm" variant="outline">
              Soon
            </Badge>
          )}
        </>
      )}
    </NavLink>
  )
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-14 items-center border-b border-neutral-200 px-4">
        <NavLink to="/" onClick={onNavigate} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950">
          <Wordmark />
        </NavLink>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5" aria-label="Primary">
        {NAV.map((section, si) => (
          <div key={section.title ?? `s-${si}`}>
            {section.title && (
              <p className="mb-1.5 px-2.5 text-2xs font-semibold uppercase tracking-wider text-neutral-400">
                {section.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const sectionActive = item.children
                  ? pathname === item.to || pathname.startsWith(`${item.to}/`)
                  : false
                return (
                  <li key={item.to + item.label}>
                    <ItemLink item={item} onNavigate={onNavigate} />
                    {item.children && sectionActive && (
                      <ul className="mt-0.5 space-y-0.5">
                        {item.children.map((child) => (
                          <li key={child.to + child.label}>
                            <LeafLink leaf={child} onNavigate={onNavigate} nested />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-neutral-200 p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <Avatar name="Swift Studioz" size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-900">Swift Studioz</p>
            <p className="truncate text-2xs text-neutral-500">Workspace</p>
          </div>
        </div>
      </div>
    </div>
  )
}
