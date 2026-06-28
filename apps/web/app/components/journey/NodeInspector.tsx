import type {
  AbSplitConfig,
  ActionConfig,
  ConditionConfig,
  DelayConfig,
  JourneyNodeData,
  TriggerConfig,
} from './types'
import {
  CHANNELS,
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  STEP_META,
} from './types'
import type { JourneyNode } from './graph-transform'

interface Props {
  node: JourneyNode | null
  onConfigChange: (nodeId: string, config: JourneyNodeData['config']) => void
  onDelete: (nodeId: string) => void
}

const s: Record<string, React.CSSProperties> = {
  panel: {
    width: 300,
    flexShrink: 0,
    borderLeft: '1px solid #e5e7eb',
    background: '#fff',
    padding: '16px',
    overflowY: 'auto',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  empty: { color: '#9ca3af', fontSize: 13, lineHeight: 1.5 },
  heading: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', margin: '12px 0 4px' },
  input: {
    display: 'block',
    width: '100%',
    padding: '6px 8px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 13,
    boxSizing: 'border-box',
  },
  row: { display: 'flex', gap: 8 },
  deleteBtn: {
    marginTop: 20,
    width: '100%',
    padding: '8px',
    background: '#fef2f2',
    color: '#dc2626',
    border: '1px solid #fecaca',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  },
}

export function NodeInspector({ node, onConfigChange, onDelete }: Props): JSX.Element {
  if (!node) {
    return (
      <aside style={s.panel}>
        <p style={s.empty}>Select a node to edit its configuration, or drag from the palette to add one.</p>
      </aside>
    )
  }

  const meta = STEP_META[node.data.stepType]
  const update = (config: JourneyNodeData['config']): void => onConfigChange(node.id, config)

  return (
    <aside style={s.panel}>
      <div style={s.heading}>
        <span>{meta.icon}</span>
        <strong style={{ color: meta.accent, fontSize: 14 }}>{meta.title}</strong>
      </div>
      <p style={{ ...s.empty, marginTop: 0 }}>{meta.description}</p>

      {node.data.stepType === 'TRIGGER' && (
        <TriggerForm config={node.data.config as TriggerConfig} onChange={update} />
      )}
      {node.data.stepType === 'ACTION' && (
        <ActionForm config={node.data.config as ActionConfig} onChange={update} />
      )}
      {node.data.stepType === 'CONDITION' && (
        <ConditionForm config={node.data.config as ConditionConfig} onChange={update} />
      )}
      {node.data.stepType === 'DELAY' && (
        <DelayForm config={node.data.config as DelayConfig} onChange={update} />
      )}
      {node.data.stepType === 'AB_SPLIT' && (
        <AbSplitForm config={node.data.config as AbSplitConfig} onChange={update} />
      )}

      {node.data.stepType !== 'TRIGGER' && (
        <button type="button" style={s.deleteBtn} onClick={() => onDelete(node.id)}>
          Delete node
        </button>
      )}
    </aside>
  )
}

function TriggerForm({ config, onChange }: { config: TriggerConfig; onChange: (c: TriggerConfig) => void }): JSX.Element {
  return (
    <>
      <label style={s.label}>Trigger type</label>
      <select
        style={s.input}
        value={config.triggerType ?? 'segment_entered'}
        onChange={(e) => onChange({ ...config, triggerType: e.target.value as TriggerConfig['triggerType'] })}
      >
        <option value="segment_entered">Segment entered</option>
        <option value="order_placed">Order placed</option>
        <option value="custom_event">Custom event</option>
        <option value="scheduled">Scheduled</option>
      </select>
      {config.triggerType === 'segment_entered' && (
        <>
          <label style={s.label}>Segment ID</label>
          <input
            style={s.input}
            value={config.segmentId ?? ''}
            placeholder="cmq…"
            onChange={(e) => onChange({ ...config, segmentId: e.target.value })}
          />
        </>
      )}
      {config.triggerType === 'custom_event' && (
        <>
          <label style={s.label}>Event name</label>
          <input
            style={s.input}
            value={config.eventName ?? ''}
            placeholder="e.g. quiz_completed"
            onChange={(e) => onChange({ ...config, eventName: e.target.value })}
          />
        </>
      )}
    </>
  )
}

function ActionForm({ config, onChange }: { config: ActionConfig; onChange: (c: ActionConfig) => void }): JSX.Element {
  return (
    <>
      <label style={s.label}>Channel</label>
      <select
        style={s.input}
        value={config.channel ?? 'WHATSAPP'}
        onChange={(e) => onChange({ ...config, channel: e.target.value as ActionConfig['channel'] })}
      >
        {CHANNELS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      {config.channel === 'EMAIL' && (
        <>
          <label style={s.label}>Subject</label>
          <input
            style={s.input}
            value={config.content?.subject ?? ''}
            onChange={(e) => onChange({ ...config, content: { ...config.content, subject: e.target.value } })}
          />
        </>
      )}
      <label style={s.label}>Message body</label>
      <textarea
        style={{ ...s.input, minHeight: 90, resize: 'vertical' }}
        value={config.content?.body ?? ''}
        placeholder="Use {{first_name}} for personalisation"
        onChange={(e) => onChange({ ...config, content: { ...config.content, body: e.target.value } })}
      />
    </>
  )
}

function ConditionForm({ config, onChange }: { config: ConditionConfig; onChange: (c: ConditionConfig) => void }): JSX.Element {
  return (
    <>
      <label style={s.label}>Field</label>
      <select
        style={s.input}
        value={config.field ?? CONDITION_FIELDS[0]!.value}
        onChange={(e) => onChange({ ...config, field: e.target.value })}
      >
        {CONDITION_FIELDS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <label style={s.label}>Operator</label>
      <select
        style={s.input}
        value={config.operator ?? 'gte'}
        onChange={(e) => onChange({ ...config, operator: e.target.value })}
      >
        {CONDITION_OPERATORS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <label style={s.label}>Value</label>
      <input
        style={s.input}
        value={String(config.value ?? '')}
        onChange={(e) => {
          const raw = e.target.value
          const num = Number(raw)
          onChange({ ...config, value: raw !== '' && !Number.isNaN(num) ? num : raw })
        }}
      />
      <p style={{ ...s.empty, marginTop: 8 }}>
        The <strong>true</strong> branch runs when the condition matches; <strong>false</strong> otherwise.
      </p>
    </>
  )
}

function DelayForm({ config, onChange }: { config: DelayConfig; onChange: (c: DelayConfig) => void }): JSX.Element {
  return (
    <>
      <label style={s.label}>Wait</label>
      <div style={s.row}>
        <input
          type="number"
          min={1}
          style={{ ...s.input, width: 90 }}
          value={config.duration ?? 1}
          onChange={(e) => onChange({ ...config, duration: Math.max(1, Number(e.target.value) || 1) })}
        />
        <select
          style={s.input}
          value={config.unit ?? 'days'}
          onChange={(e) => onChange({ ...config, unit: e.target.value as DelayConfig['unit'] })}
        >
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
      </div>
    </>
  )
}

function AbSplitForm({ config, onChange }: { config: AbSplitConfig; onChange: (c: AbSplitConfig) => void }): JSX.Element {
  const variants = config.variants ?? []
  const total = variants.reduce((sum, v) => sum + (v.weight || 0), 0)
  return (
    <>
      <label style={s.label}>Variants</label>
      {variants.map((v, i) => (
        <div key={v.key} style={{ ...s.row, marginBottom: 6, alignItems: 'center' }}>
          <input
            style={{ ...s.input, flex: 1 }}
            value={v.label}
            onChange={(e) => {
              const next = variants.slice()
              next[i] = { ...v, label: e.target.value }
              onChange({ variants: next })
            }}
          />
          <input
            type="number"
            min={0}
            max={100}
            style={{ ...s.input, width: 70 }}
            value={v.weight}
            onChange={(e) => {
              const next = variants.slice()
              next[i] = { ...v, weight: Math.max(0, Number(e.target.value) || 0) }
              onChange({ variants: next })
            }}
          />
          <span style={{ fontSize: 12, color: '#9ca3af' }}>%</span>
        </div>
      ))}
      <p style={{ ...s.empty, color: total === 100 ? '#059669' : '#d97706' }}>
        Weights total {total}% {total === 100 ? '✓' : '(should be 100%)'}
      </p>
      <p style={{ ...s.empty, marginTop: 4 }}>
        Note: branch execution for A/B Split is not yet wired in the engine — variants persist but a
        customer reaching this node completes the journey until the executor supports it.
      </p>
    </>
  )
}
