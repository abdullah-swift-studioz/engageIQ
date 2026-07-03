import { useState } from 'react'
import type { EmailBlock, EmailProductSource } from '@engageiq/shared'
import { Button, Input, Textarea, Select, Label, Icons } from '~/components/ui'
import { BLOCK_PALETTE, createBlock, blockLabel, move, type BlockType } from './blocks'

interface SegmentOption {
  id: string
  name: string
}

interface BlockCardProps {
  block: EmailBlock
  index: number
  count: number
  segments: SegmentOption[]
  nested?: boolean
  onChange: (next: EmailBlock) => void
  onDelete: () => void
  onMove: (from: number, to: number) => void
  onDragStart?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: () => void
}

const ALIGNS = ['left', 'center', 'right'] as const

// One block's inline editor. Recurses for conditional blocks (their children reuse this
// same card with `nested`). Monochrome throughout — state shown by shade/border/icon.
export function BlockCard(props: BlockCardProps) {
  const { block, index, count, segments } = props
  const patch = (partial: Partial<EmailBlock>) => props.onChange({ ...block, ...partial } as EmailBlock)

  return (
    <div
      draggable={!props.nested}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      className="rounded-lg border border-neutral-200 bg-white p-3 shadow-xs"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!props.nested && <Icons.Menu className="size-4 cursor-grab text-neutral-400" />}
          <span className="text-2xs font-semibold uppercase tracking-wide text-neutral-500">
            {blockLabel(block.type)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Move up"
            disabled={index === 0}
            onClick={() => props.onMove(index, index - 1)}
          >
            <Icons.ChevronUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Move down"
            disabled={index === count - 1}
            onClick={() => props.onMove(index, index + 1)}
          >
            <Icons.ChevronDown className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Delete block" onClick={props.onDelete}>
            <Icons.X className="size-4" />
          </Button>
        </div>
      </div>

      <BlockFields block={block} segments={segments} patch={patch} onChange={props.onChange} />
    </div>
  )
}

function AlignSelect({ value, onChange }: { value?: string; onChange: (v: 'left' | 'center' | 'right') => void }) {
  return (
    <div>
      <Label>Align</Label>
      <Select value={value ?? 'left'} onChange={(e) => onChange(e.target.value as 'left' | 'center' | 'right')}>
        {ALIGNS.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </Select>
    </div>
  )
}

function BlockFields({
  block,
  segments,
  patch,
  onChange,
}: {
  block: EmailBlock
  segments: SegmentOption[]
  patch: (p: Partial<EmailBlock>) => void
  onChange: (next: EmailBlock) => void
}) {
  switch (block.type) {
    case 'text':
      return (
        <div className="space-y-2">
          <Textarea
            rows={4}
            value={block.html}
            onChange={(e) => patch({ html: e.target.value })}
            placeholder="Write your copy. Use {{customer.first_name}} for personalization."
          />
          <AlignSelect value={block.align} onChange={(align) => patch({ align })} />
        </div>
      )

    case 'image':
      return (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Label>Image URL</Label>
            <Input value={block.src} onChange={(e) => patch({ src: e.target.value })} placeholder="https://…" />
          </div>
          <div>
            <Label>Alt text</Label>
            <Input value={block.alt ?? ''} onChange={(e) => patch({ alt: e.target.value })} />
          </div>
          <div>
            <Label>Link (optional)</Label>
            <Input value={block.href ?? ''} onChange={(e) => patch({ href: e.target.value })} placeholder="https://…" />
          </div>
          <AlignSelect value={block.align} onChange={(align) => patch({ align })} />
        </div>
      )

    case 'button':
      return (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Label</Label>
            <Input value={block.text} onChange={(e) => patch({ text: e.target.value })} />
          </div>
          <div>
            <Label>Link</Label>
            <Input value={block.href} onChange={(e) => patch({ href: e.target.value })} placeholder="https://…" />
          </div>
          <AlignSelect value={block.align} onChange={(align) => patch({ align })} />
        </div>
      )

    case 'divider':
      return <p className="text-sm text-neutral-500">A horizontal rule.</p>

    case 'spacer':
      return (
        <div className="w-32">
          <Label>Height (px)</Label>
          <Input
            type="number"
            min={0}
            max={200}
            value={block.height}
            onChange={(e) => patch({ height: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })}
          />
        </div>
      )

    case 'dynamic-product':
      return (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Source</Label>
            <Select
              value={block.source}
              onChange={(e) => patch({ source: e.target.value as EmailProductSource })}
            >
              <option value="top_sellers">Top sellers</option>
              <option value="recommended">Recommended (per customer)</option>
              <option value="viewed">Recently viewed</option>
              <option value="manual">Manual pick</option>
            </Select>
          </div>
          <div>
            <Label>Heading</Label>
            <Input value={block.heading ?? ''} onChange={(e) => patch({ heading: e.target.value })} />
          </div>
          <div>
            <Label>Count</Label>
            <Input
              type="number"
              min={1}
              max={12}
              value={block.limit}
              onChange={(e) => patch({ limit: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })}
            />
          </div>
          <div>
            <Label>Columns</Label>
            <Input
              type="number"
              min={1}
              max={4}
              value={block.columns ?? 3}
              onChange={(e) => patch({ columns: Math.max(1, Math.min(4, Number(e.target.value) || 1)) })}
            />
          </div>
          {block.source === 'manual' && (
            <div className="col-span-2">
              <Label>Product IDs (comma-separated)</Label>
              <Input
                value={(block.productIds ?? []).join(', ')}
                onChange={(e) => patch({ productIds: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              />
            </div>
          )}
        </div>
      )

    case 'conditional':
      return <ConditionalFields block={block} segments={segments} onChange={onChange} />

    default:
      return null
  }
}

// Conditional block: pick a segment, then edit a nested list of child blocks.
function ConditionalFields({
  block,
  segments,
  onChange,
}: {
  block: Extract<EmailBlock, { type: 'conditional' }>
  segments: SegmentOption[]
  onChange: (next: EmailBlock) => void
}) {
  const [adding, setAdding] = useState(false)
  const setChildren = (children: EmailBlock[]) => onChange({ ...block, blocks: children })

  return (
    <div className="space-y-3">
      <div>
        <Label required>Show only to segment</Label>
        <Select value={block.segmentId} onChange={(e) => onChange({ ...block, segmentId: e.target.value })}>
          <option value="">Select a segment…</option>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-2 border-l-2 border-neutral-200 pl-3">
        {block.blocks.length === 0 && (
          <p className="text-sm text-neutral-500">No content yet — add a block shown only to this segment.</p>
        )}
        {block.blocks.map((child, i) => (
          <BlockCard
            key={child.id}
            block={child}
            index={i}
            count={block.blocks.length}
            segments={segments}
            nested
            onChange={(next) => setChildren(block.blocks.map((b, j) => (j === i ? next : b)))}
            onDelete={() => setChildren(block.blocks.filter((_, j) => j !== i))}
            onMove={(from, to) => setChildren(move(block.blocks, from, to))}
          />
        ))}

        {adding ? (
          <div className="flex flex-wrap gap-1">
            {BLOCK_PALETTE.filter((p) => p.type !== 'conditional').map((p) => (
              <Button
                key={p.type}
                variant="secondary"
                size="sm"
                onClick={() => {
                  setChildren([...block.blocks, createBlock(p.type as BlockType)])
                  setAdding(false)
                }}
              >
                {p.label}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" leftIcon={<Icons.Plus className="size-4" />} onClick={() => setAdding(true)}>
            Add nested block
          </Button>
        )}
      </div>
    </div>
  )
}
