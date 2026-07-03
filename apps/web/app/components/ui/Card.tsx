import * as React from 'react'
import { cn } from './cn'

type DivProps = React.HTMLAttributes<HTMLDivElement>

export function Card({ className, ...props }: DivProps) {
  return (
    <div
      className={cn('rounded-lg border border-neutral-200 bg-white shadow-xs', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: DivProps) {
  return (
    <div
      className={cn('flex items-start justify-between gap-4 px-5 pt-5', className)}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-base font-semibold tracking-tight text-neutral-950', className)} {...props} />
  )
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-neutral-500', className)} {...props} />
}

export function CardContent({ className, ...props }: DivProps) {
  return <div className={cn('p-5', className)} {...props} />
}

export function CardFooter({ className, ...props }: DivProps) {
  return (
    <div
      className={cn('flex items-center gap-3 border-t border-neutral-200 px-5 py-4', className)}
      {...props}
    />
  )
}
