// Editor-only types for the visual journey builder (lane:journey).
// These describe the client-side canvas model and the wire shape exchanged with the API.
// They intentionally live in the web package (not @engageiq/shared): nothing else consumes them,
// and the API contract is enforced by the Zod schema on the server side.

export type StepType = 'TRIGGER' | 'ACTION' | 'CONDITION' | 'DELAY' | 'AB_SPLIT'

export type Channel = 'WHATSAPP' | 'EMAIL' | 'SMS' | 'PUSH'

export type DelayUnit = 'minutes' | 'hours' | 'days'

export type TriggerConfig = {
  triggerType: 'segment_entered' | 'order_placed' | 'custom_event' | 'scheduled'
  segmentId?: string
  eventName?: string
}

export type ActionConfig = {
  channel: Channel
  content: { body: string; subject?: string }
}

export type ConditionConfig = {
  field: string
  operator: string
  value: string | number | boolean
}

export type DelayConfig = {
  duration: number
  unit: DelayUnit
}

export type AbSplitVariant = { key: string; label: string; weight: number }

export type AbSplitConfig = {
  variants: AbSplitVariant[]
}

export type StepConfig =
  | TriggerConfig
  | ActionConfig
  | ConditionConfig
  | DelayConfig
  | AbSplitConfig
  | Record<string, unknown>

// Data carried on each React Flow node.
export interface JourneyNodeData {
  stepType: StepType
  config: StepConfig
  // For nodes whose parent is a CONDITION or AB_SPLIT, this is the branch key the executor
  // routes on (CONDITION: 'true' | 'false'). Carried back to the API as the step `label`.
  branchLabel: string | null
  [key: string]: unknown
}

// ── Wire shapes (must match apps/api/src/routes/journeys/schema.ts) ──

// A step as returned by GET /api/v1/journeys/:id.
// `config` is optional because Remix's Jsonify widens `unknown` to optional across the loader.
export interface ApiJourneyStep {
  id: string
  stepType: StepType
  label: string | null
  config?: unknown
  parentStepId: string | null
  positionX: number
  positionY: number
}

// A node as posted to PUT /api/v1/journeys/:id/graph.
export interface GraphSaveNode {
  tempId: string
  stepType: StepType
  label: string | null
  config: unknown
  positionX: number
  positionY: number
  parentTempId: string | null
}

export interface ApiJourney {
  id: string
  name: string
  description: string | null
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
  triggerType: string
  triggerConfig?: unknown
  reEntryRule: string
  exitTrigger: string | null
  enrollmentCount: number
  completionCount: number
  steps: ApiJourneyStep[]
}

// Palette / presentation metadata, keyed by step type.
export interface StepMeta {
  type: StepType
  title: string
  description: string
  color: string
  accent: string
  icon: string
}

export const STEP_META: Record<StepType, StepMeta> = {
  TRIGGER: {
    type: 'TRIGGER',
    title: 'Trigger',
    description: 'Entry point — enrols a customer',
    color: '#ecfdf5',
    accent: '#059669',
    icon: '⚡',
  },
  ACTION: {
    type: 'ACTION',
    title: 'Action',
    description: 'Send a message on a channel',
    color: '#eef2ff',
    accent: '#4f46e5',
    icon: '✉️',
  },
  CONDITION: {
    type: 'CONDITION',
    title: 'Condition',
    description: 'Branch on a customer property',
    color: '#fffbeb',
    accent: '#d97706',
    icon: '◆',
  },
  DELAY: {
    type: 'DELAY',
    title: 'Delay',
    description: 'Wait before continuing',
    color: '#f0f9ff',
    accent: '#0284c7',
    icon: '⏱',
  },
  AB_SPLIT: {
    type: 'AB_SPLIT',
    title: 'A/B Split',
    description: 'Randomly split into variants',
    color: '#fdf4ff',
    accent: '#c026d3',
    icon: '⑂',
  },
}

// Channels available to ACTION nodes (matches ActionStepConfig in @engageiq/shared).
export const CHANNELS: Channel[] = ['WHATSAPP', 'EMAIL', 'SMS', 'PUSH']

// Condition fields offered in the inspector. These map onto the in-memory profile fields the
// executor's segment-evaluator understands (buildProfileFromCustomer). Kept small and safe.
export const CONDITION_FIELDS: { value: string; label: string }[] = [
  { value: 'total_orders', label: 'Total orders' },
  { value: 'total_spent', label: 'Total spent (PKR)' },
  { value: 'churn_score', label: 'Churn score (0–100)' },
  { value: 'is_subscribed_whatsapp', label: 'Subscribed to WhatsApp' },
]

export const CONDITION_OPERATORS: { value: string; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
]
