import * as React from 'react'
import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0'

const variants: Record<ButtonVariant, string> = {
  // solid black — the single high-emphasis action on a view
  primary: 'bg-neutral-950 text-white hover:bg-neutral-800 active:bg-neutral-950',
  // outline — neutral, repeatable secondary action
  secondary:
    'border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50 active:bg-neutral-100',
  // ghost — low emphasis, toolbars and inline actions
  ghost: 'text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 active:bg-neutral-200',
  // solid pure-black — distinguishes destructive from primary without hue
  destructive: 'bg-black text-white hover:bg-neutral-900 active:bg-black',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm [&_svg]:size-4',
  md: 'h-9 px-4 text-sm [&_svg]:size-4',
  lg: 'h-10 px-5 text-[15px] [&_svg]:size-[18px]',
  icon: 'h-9 w-9 [&_svg]:size-4',
}

export function buttonVariants(opts?: {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}): string {
  return cn(
    base,
    variants[opts?.variant ?? 'primary'],
    sizes[opts?.size ?? 'md'],
    opts?.className,
  )
}

function Spinner() {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner and disables the button; keeps width stable. */
  isLoading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, isLoading, leftIcon, rightIcon, children, className, disabled, type, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={buttonVariants({ variant, size, className })}
      {...props}
    >
      {isLoading ? <Spinner /> : leftIcon}
      {children}
      {!isLoading && rightIcon}
    </button>
  )
})
