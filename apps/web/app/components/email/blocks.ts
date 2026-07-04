// apps/web/app/components/email/blocks.ts
//
// Client-side block model helpers for the email builder. The block shapes come from
// @engageiq/shared (single source of truth shared with the API renderer).
import type { EmailBlock } from '@engageiq/shared'

export type BlockType = EmailBlock['type']

export interface BlockMeta {
  type: BlockType
  label: string
  // Short one-liner shown in the palette.
  hint: string
}

// The palette, in insertion order. Personalization tokens live inside text blocks.
export const BLOCK_PALETTE: BlockMeta[] = [
  { type: 'text', label: 'Text', hint: 'Rich text with {{tokens}}' },
  { type: 'image', label: 'Image', hint: 'A linked image' },
  { type: 'button', label: 'Button', hint: 'A call-to-action' },
  { type: 'divider', label: 'Divider', hint: 'A horizontal rule' },
  { type: 'spacer', label: 'Spacer', hint: 'Vertical space' },
  { type: 'dynamic-product', label: 'Products', hint: 'Live product grid' },
  { type: 'conditional', label: 'Conditional', hint: 'Show to one segment' },
]

// Stable-enough unique id for a new block (browser crypto, falls back to time+rand-free counter).
let counter = 0
function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `b_${crypto.randomUUID().slice(0, 8)}`
  counter += 1
  return `b_${counter}_${counter * 7919}`
}

export function createBlock(type: BlockType): EmailBlock {
  const id = newId()
  switch (type) {
    case 'text':
      return { id, type: 'text', html: 'New text — write anything, use {{customer.first_name}} for personalization.', align: 'left' }
    case 'image':
      return { id, type: 'image', src: 'https://via.placeholder.com/600x240', alt: '', align: 'center' }
    case 'button':
      return { id, type: 'button', text: 'Shop now', href: 'https://', align: 'center' }
    case 'divider':
      return { id, type: 'divider' }
    case 'spacer':
      return { id, type: 'spacer', height: 24 }
    case 'dynamic-product':
      return { id, type: 'dynamic-product', source: 'top_sellers', limit: 3, columns: 3, heading: 'You might like' }
    case 'conditional':
      return { id, type: 'conditional', segmentId: '', label: '', blocks: [] }
    default:
      return { id, type: 'divider' }
  }
}

export function blockLabel(type: BlockType): string {
  return BLOCK_PALETTE.find((b) => b.type === type)?.label ?? type
}

// Move an item within an array (immutably); returns a new array.
export function move<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
  const next = [...arr]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item as T)
  return next
}
