import * as React from 'react'
import { cn } from './cn'
import { ChevronRight } from './icons'

export interface BreadcrumbItem {
  label: React.ReactNode
  href?: string
}

export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[]
}

/**
 * Data-driven breadcrumb. Items with `href` render as links; the final item is
 * always the current page (`aria-current="page"`). Uses plain <a> so the
 * component stays router-agnostic.
 */
export function Breadcrumb({ items, className, ...props }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)} {...props}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          return (
            <li key={i} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <a
                  href={item.href}
                  className="rounded text-neutral-500 transition-colors hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
                >
                  {item.label}
                </a>
              ) : (
                <span
                  className={isLast ? 'font-medium text-neutral-950' : 'text-neutral-500'}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast && (
                <ChevronRight className="size-3.5 text-neutral-300" aria-hidden="true" />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
