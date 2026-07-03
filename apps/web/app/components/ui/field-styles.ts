/**
 * Shared field styling for text-like inputs (Input, Textarea, Select).
 * Centralized so the three controls stay pixel-identical. Error state is shown
 * with a darker/heavier border and ring — never a hue.
 */
export const fieldBase =
  'block w-full rounded-md border bg-white text-sm text-neutral-950 shadow-xs transition-colors placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:opacity-60'

export function fieldBorder(invalid?: boolean): string {
  return invalid
    ? 'border-neutral-950 focus-visible:border-neutral-950 focus-visible:ring-neutral-950/15'
    : 'border-neutral-300 hover:border-neutral-400 focus-visible:border-neutral-950 focus-visible:ring-neutral-950/10'
}
