import * as React from 'react'
import { cn } from './cn'
import { ChevronLeft, ChevronRight } from './icons'

/** Build a page list with ellipses, e.g. [1, '…', 4, 5, 6, '…', 20]. */
function pageRange(page: number, pageCount: number, siblings: number): (number | 'ellipsis')[] {
  const totalSlots = siblings * 2 + 5 // first, last, current, 2×siblings, 2 ellipses
  if (pageCount <= totalSlots) {
    return Array.from({ length: pageCount }, (_, i) => i + 1)
  }
  const left = Math.max(page - siblings, 1)
  const right = Math.min(page + siblings, pageCount)
  const showLeftDots = left > 2
  const showRightDots = right < pageCount - 1
  const out: (number | 'ellipsis')[] = [1]
  if (showLeftDots) out.push('ellipsis')
  const start = showLeftDots ? left : 2
  const end = showRightDots ? right : pageCount - 1
  for (let p = start; p <= end; p++) out.push(p)
  if (showRightDots) out.push('ellipsis')
  out.push(pageCount)
  return out
}

const cell =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40'

export interface PaginationProps {
  /** Current page, 1-based. */
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  siblingCount?: number
  className?: string
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  siblingCount = 1,
  className,
}: PaginationProps) {
  if (pageCount <= 1) return null
  const pages = pageRange(page, pageCount, siblingCount)
  const go = (p: number) => onPageChange(Math.min(Math.max(p, 1), pageCount))

  return (
    <nav
      aria-label="Pagination"
      className={cn('flex items-center gap-1', className)}
    >
      <button
        type="button"
        className={cn(cell, 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950')}
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft className="size-4" />
      </button>

      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <span
            key={`e${i}`}
            className="inline-flex h-8 min-w-8 items-center justify-center px-1 text-sm text-neutral-400"
            aria-hidden="true"
          >
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            className={cn(
              cell,
              p === page
                ? 'bg-neutral-950 text-white'
                : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950',
            )}
            onClick={() => go(p)}
            aria-current={p === page ? 'page' : undefined}
            aria-label={`Page ${p}`}
          >
            {p}
          </button>
        ),
      )}

      <button
        type="button"
        className={cn(cell, 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950')}
        onClick={() => go(page + 1)}
        disabled={page >= pageCount}
        aria-label="Next page"
      >
        <ChevronRight className="size-4" />
      </button>
    </nav>
  )
}
