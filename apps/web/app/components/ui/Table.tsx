import * as React from 'react'
import { cn } from './cn'

/**
 * Composable table. `Table` wraps the `<table>` in a bordered, horizontally
 * scrollable container so wide tables never break the page layout.
 *
 *   <Table>
 *     <TableHeader><TableRow><TableHead>Name</TableHead>…</TableRow></TableHeader>
 *     <TableBody>
 *       {rows.length === 0
 *         ? <TableEmpty colSpan={4}>No customers yet.</TableEmpty>
 *         : rows.map(r => <TableRow key={r.id}>…</TableRow>)}
 *     </TableBody>
 *   </Table>
 */
export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-neutral-200">
      <table className={cn('w-full caption-bottom border-collapse text-sm', className)} {...props} />
    </div>
  )
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-neutral-50', className)} {...props} />
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-neutral-100', className)} {...props} />
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('border-b border-neutral-200 transition-colors hover:bg-neutral-50', className)} {...props} />
  )
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-wider text-neutral-500',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 align-middle text-neutral-800', className)} {...props} />
}

export function TableCaption({ className, ...props }: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={cn('mt-3 text-sm text-neutral-500', className)} {...props} />
}

export interface TableEmptyProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  colSpan: number
}

/** A full-width empty-state row for tables with no data. */
export function TableEmpty({ colSpan, className, children, ...props }: TableEmptyProps) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={cn('px-4 py-12 text-center text-sm text-neutral-500', className)}
        {...props}
      >
        {children ?? 'No data to display.'}
      </td>
    </tr>
  )
}
