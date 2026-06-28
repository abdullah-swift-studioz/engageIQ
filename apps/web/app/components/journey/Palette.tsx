import type { StepType } from './types'
import { STEP_META } from './types'

// Trigger is the fixed root and is created with the journey, so it is not in the add-palette.
const ADDABLE: StepType[] = ['ACTION', 'CONDITION', 'DELAY', 'AB_SPLIT']

interface Props {
  disabled: boolean
  onAdd: (stepType: StepType) => void
}

// The palette supports two interactions: drag onto the canvas (HTML5 DnD; the canvas reads the
// step type from dataTransfer on drop) and click-to-add (drops at a default position).
export function Palette({ disabled, onAdd }: Props): JSX.Element {
  return (
    <aside style={s.panel}>
      <h3 style={s.title}>Add step</h3>
      {ADDABLE.map((type) => {
        const meta = STEP_META[type]
        return (
          <button
            key={type}
            type="button"
            draggable={!disabled}
            disabled={disabled}
            onClick={() => !disabled && onAdd(type)}
            onDragStart={(e) => {
              e.dataTransfer.setData('application/engageiq-step', type)
              e.dataTransfer.effectAllowed = 'move'
            }}
            style={{
              ...s.item,
              borderColor: `${meta.accent}33`,
              background: meta.color,
              cursor: disabled ? 'not-allowed' : 'grab',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <span style={{ fontSize: 15 }}>{meta.icon}</span>
            <span>
              <strong style={{ display: 'block', fontSize: 13, color: meta.accent }}>{meta.title}</strong>
              <span style={{ fontSize: 11, color: '#6b7280' }}>{meta.description}</span>
            </span>
          </button>
        )
      })}
      {disabled && (
        <p style={s.hint}>Only DRAFT journeys can be edited. Pause or duplicate to make changes.</p>
      )}
    </aside>
  )
}

const s: Record<string, React.CSSProperties> = {
  panel: {
    width: 220,
    flexShrink: 0,
    borderRight: '1px solid #e5e7eb',
    background: '#fff',
    padding: '16px',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  title: { fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    textAlign: 'left',
    padding: '10px 12px',
    marginBottom: 8,
    border: '1px solid',
    borderRadius: 8,
  },
  hint: { fontSize: 11, color: '#9ca3af', lineHeight: 1.5, marginTop: 12 },
}
