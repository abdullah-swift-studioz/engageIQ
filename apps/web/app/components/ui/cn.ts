/**
 * cn — tiny, dependency-free className joiner.
 *
 * Joins truthy class values into a single space-separated string. Kept
 * dependency-free on purpose (this lane must not touch the lockfile). Author
 * component classes so variant/override strings do not fight each other rather
 * than relying on tailwind-merge conflict resolution; the `className` prop is
 * always appended last so callers can override.
 */
export type ClassValue = string | number | false | null | undefined

export function cn(...values: ClassValue[]): string {
  let out = ''
  for (const v of values) {
    // Drop all falsy values (0, '', NaN, false, null, undefined) — matches
    // clsx/classnames, so `cn(items.length && 'has-items')` never emits "0".
    if (!v) continue
    out += (out ? ' ' : '') + v
  }
  return out
}
