import * as React from 'react'
import { cn } from './cn'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg'

const sizes: Record<AvatarSize, string> = {
  xs: 'size-6 text-2xs',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-12 text-base',
}

function initials(name?: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  src?: string
  /** Full name — drives the initials fallback and alt text. */
  name?: string
  size?: AvatarSize
}

export function Avatar({ src, name, size = 'md', className, ...props }: AvatarProps) {
  const [errored, setErrored] = React.useState(false)
  const showImage = src && !errored
  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-neutral-200 bg-neutral-100 font-medium text-neutral-700',
        sizes[size],
        className,
      )}
      {...props}
    >
      {showImage ? (
        <img
          src={src}
          alt={name ?? ''}
          className="size-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <span aria-hidden={name ? undefined : 'true'}>{initials(name)}</span>
      )}
    </span>
  )
}
