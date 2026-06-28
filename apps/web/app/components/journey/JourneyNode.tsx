import { Handle, Position, type NodeProps } from '@xyflow/react'
import type {
  AbSplitConfig,
  ActionConfig,
  ConditionConfig,
  DelayConfig,
  JourneyNodeData,
  TriggerConfig,
} from './types'
import { STEP_META, CONDITION_OPERATORS } from './types'

// One short human-readable line summarising a node's config, shown under the title on the canvas.
function summarise(data: JourneyNodeData): string {
  switch (data.stepType) {
    case 'TRIGGER': {
      const c = data.config as TriggerConfig
      return c.triggerType ?? 'segment_entered'
    }
    case 'ACTION': {
      const c = data.config as ActionConfig
      const body = c.content?.body ?? ''
      const preview = body.length > 28 ? `${body.slice(0, 28)}…` : body
      return `${c.channel ?? 'WHATSAPP'}${preview ? ` · ${preview}` : ''}`
    }
    case 'CONDITION': {
      const c = data.config as ConditionConfig
      const op = CONDITION_OPERATORS.find((o) => o.value === c.operator)?.label ?? c.operator
      return `${c.field ?? '?'} ${op ?? ''} ${String(c.value ?? '')}`.trim()
    }
    case 'DELAY': {
      const c = data.config as DelayConfig
      return `wait ${c.duration ?? 0} ${c.unit ?? 'days'}`
    }
    case 'AB_SPLIT': {
      const c = data.config as AbSplitConfig
      const variants = c.variants ?? []
      return variants.map((v) => `${v.label} ${v.weight}%`).join(' / ') || 'no variants'
    }
    default:
      return ''
  }
}

const handleStyle: React.CSSProperties = {
  width: 10,
  height: 10,
  background: '#fff',
  border: '2px solid #9ca3af',
}

export function JourneyNode({ data, selected }: NodeProps): JSX.Element {
  const d = data as JourneyNodeData
  const meta = STEP_META[d.stepType]
  const isCondition = d.stepType === 'CONDITION'
  const isSplit = d.stepType === 'AB_SPLIT'
  const isTrigger = d.stepType === 'TRIGGER'
  const variants = isSplit ? ((d.config as AbSplitConfig).variants ?? []) : []

  return (
    <div
      style={{
        position: 'relative',
        width: 220,
        background: '#fff',
        border: `2px solid ${selected ? meta.accent : '#e5e7eb'}`,
        borderRadius: 10,
        boxShadow: selected
          ? `0 0 0 3px ${meta.accent}22, 0 4px 12px rgba(0,0,0,0.08)`
          : '0 1px 3px rgba(0,0,0,0.08)',
        overflow: 'hidden',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* Incoming handle (all except the trigger root). */}
      {!isTrigger && (
        <Handle type="target" position={Position.Top} style={handleStyle} />
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: meta.color,
          borderBottom: `1px solid ${meta.accent}22`,
        }}
      >
        <span style={{ fontSize: 14 }}>{meta.icon}</span>
        <strong style={{ fontSize: 13, color: meta.accent }}>{meta.title}</strong>
      </div>

      <div style={{ padding: '8px 12px', fontSize: 12, color: '#374151', minHeight: 18 }}>
        {summarise(d) || <span style={{ color: '#9ca3af' }}>not configured</span>}
      </div>

      {/* Outgoing handles. Linear nodes get one; branching nodes get a labelled handle per branch. */}
      {isCondition ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 24px 6px' }}>
          <BranchPill label="true" color="#059669" />
          <BranchPill label="false" color="#dc2626" />
          <Handle
            id="true"
            type="source"
            position={Position.Bottom}
            style={{ ...handleStyle, left: '28%', borderColor: '#059669' }}
          />
          <Handle
            id="false"
            type="source"
            position={Position.Bottom}
            style={{ ...handleStyle, left: '72%', borderColor: '#dc2626' }}
          />
        </div>
      ) : isSplit ? (
        <div style={{ display: 'flex', justifyContent: 'space-around', padding: '0 12px 6px' }}>
          {variants.map((v, i) => (
            <div key={v.key} style={{ position: 'relative', flex: 1, textAlign: 'center' }}>
              <BranchPill label={v.key} color={meta.accent} />
              <Handle
                id={v.key}
                type="source"
                position={Position.Bottom}
                style={{
                  ...handleStyle,
                  left: `${((i + 0.5) / Math.max(variants.length, 1)) * 100}%`,
                  borderColor: meta.accent,
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <Handle type="source" position={Position.Bottom} style={handleStyle} />
      )}
    </div>
  )
}

function BranchPill({ label, color }: { label: string; color: string }): JSX.Element {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color,
        background: `${color}14`,
        padding: '1px 6px',
        borderRadius: 6,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
      }}
    >
      {label}
    </span>
  )
}

export const nodeTypes = { journeyNode: JourneyNode }
