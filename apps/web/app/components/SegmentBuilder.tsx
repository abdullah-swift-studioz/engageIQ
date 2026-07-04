import { useState } from 'react'
import type { SegmentGroup, SegmentCondition, ConditionOperator } from '@engageiq/shared'
import { Input, Select, Textarea, Button, FormField, Icons } from '~/components/ui'

// ─── Field metadata for UI rendering ────────────────────────────────────────

const FIELD_OPTIONS: { value: string; label: string; type: string }[] = [
  { value: 'total_spent',            label: 'Total Spent (PKR)',     type: 'number' },
  { value: 'total_orders',           label: 'Total Orders',          type: 'number' },
  { value: 'average_order_value',    label: 'Avg Order Value',       type: 'number' },
  { value: 'rfm_segment',            label: 'RFM Segment',           type: 'enum' },
  { value: 'recency_score',          label: 'Recency Score',         type: 'number' },
  { value: 'frequency_score',        label: 'Frequency Score',       type: 'number' },
  { value: 'monetary_score',         label: 'Monetary Score',        type: 'number' },
  { value: 'churn_risk_score',       label: 'Churn Risk Score',      type: 'number' },
  { value: 'churn_risk_label',       label: 'Churn Risk Label',      type: 'enum' },
  { value: 'ltv_predicted_90d',      label: 'Predicted LTV 90d',     type: 'number' },
  { value: 'city',                   label: 'City',                  type: 'string' },
  { value: 'country',                label: 'Country',               type: 'string' },
  { value: 'accepts_marketing_email',label: 'Email Subscribed',      type: 'boolean' },
  { value: 'accepts_marketing_sms',  label: 'SMS Subscribed',        type: 'boolean' },
  { value: 'accepts_marketing_whatsapp', label: 'WhatsApp Subscribed', type: 'boolean' },
  { value: 'cod_acceptance_rate',    label: 'COD Acceptance Rate',   type: 'number' },
  { value: 'cod_fake_order_score',   label: 'Fake Order Score',      type: 'number' },
  { value: 'last_order_date',        label: 'Last Order Date',       type: 'date' },
  { value: 'last_seen_at',           label: 'Last Seen',             type: 'date' },
  { value: 'tags',                   label: 'Tags',                  type: 'array' },
]

const OPERATORS_BY_TYPE: Record<string, { value: ConditionOperator; label: string }[]> = {
  number: [
    { value: 'eq', label: '=' }, { value: 'neq', label: '≠' },
    { value: 'gt', label: '>' }, { value: 'gte', label: '>=' },
    { value: 'lt', label: '<' }, { value: 'lte', label: '<=' },
    { value: 'between', label: 'between' },
  ],
  string: [
    { value: 'eq', label: 'equals' }, { value: 'neq', label: 'not equals' },
    { value: 'contains', label: 'contains' }, { value: 'not_contains', label: 'not contains' },
    { value: 'in', label: 'in list' }, { value: 'not_in', label: 'not in list' },
  ],
  enum: [
    { value: 'eq', label: 'is' }, { value: 'neq', label: 'is not' },
    { value: 'in', label: 'in' }, { value: 'not_in', label: 'not in' },
  ],
  boolean: [
    { value: 'is_true', label: 'is true' }, { value: 'is_false', label: 'is false' },
  ],
  date: [
    { value: 'before', label: 'before' }, { value: 'after', label: 'after' },
    { value: 'between', label: 'between' },
    { value: 'within_last_days', label: 'within last N days' },
    { value: 'more_than_days_ago', label: 'more than N days ago' },
    { value: 'is_set', label: 'is set' }, { value: 'is_not_set', label: 'is not set' },
  ],
  array: [
    { value: 'includes_any', label: 'includes any of' },
    { value: 'includes_all', label: 'includes all of' },
    { value: 'includes_none', label: 'includes none of' },
  ],
}

const ENUM_VALUES: Record<string, string[]> = {
  rfm_segment: ['Champions', 'LoyalCustomers', 'PotentialLoyalists', 'NewCustomers', 'Promising', 'NeedAttention', 'AboutToSleep', 'AtRisk', 'CantLoseThem', 'Hibernating', 'Lost'],
  churn_risk_label: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
}

// ─── Value input component ────────────────────────────────────────────────────

function ValueInput({
  field,
  fieldType,
  operator,
  value,
  onChange,
}: {
  field: string
  fieldType: string
  operator: ConditionOperator
  value: unknown
  onChange: (v: unknown) => void
}) {
  const noValue: ConditionOperator[] = ['is_true', 'is_false', 'is_set', 'is_not_set']
  if (noValue.includes(operator)) return null

  if (operator === 'between') {
    const arr = Array.isArray(value) ? value : ['', '']
    return (
      <span className="inline-flex items-center gap-2">
        <Input
          type={fieldType === 'date' ? 'date' : 'number'}
          value={String(arr[0] ?? '')}
          className="w-32"
          onChange={(e) => onChange([e.target.value, arr[1]])}
        />
        <span className="text-sm text-neutral-500">and</span>
        <Input
          type={fieldType === 'date' ? 'date' : 'number'}
          value={String(arr[1] ?? '')}
          className="w-32"
          onChange={(e) => onChange([arr[0], e.target.value])}
        />
      </span>
    )
  }

  if (operator === 'within_last_days' || operator === 'more_than_days_ago') {
    return (
      <Input
        type="number"
        min="1"
        value={typeof value === 'number' ? value : ''}
        className="w-24"
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
      />
    )
  }

  if (operator === 'in' || operator === 'not_in' || operator === 'includes_any' || operator === 'includes_all' || operator === 'includes_none') {
    if (fieldType === 'enum' && ENUM_VALUES[field]) {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="w-48">
          <Select
            multiple
            value={selected}
            size={4}
            className="h-auto py-1"
            onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))}
          >
            {ENUM_VALUES[field]!.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
        </div>
      )
    }
    const str = Array.isArray(value) ? (value as string[]).join(', ') : ''
    return (
      <Input
        type="text"
        placeholder="comma-separated values"
        value={str}
        className="w-56"
        onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
      />
    )
  }

  if (fieldType === 'enum' && ENUM_VALUES[field]) {
    return (
      <div className="w-48">
        <Select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select...</option>
          {ENUM_VALUES[field]!.map((v) => <option key={v} value={v}>{v}</option>)}
        </Select>
      </div>
    )
  }

  if (fieldType === 'date') {
    return (
      <Input
        type="date"
        value={typeof value === 'string' ? value.slice(0, 10) : ''}
        className="w-44"
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : '')}
      />
    )
  }

  return (
    <Input
      type={fieldType === 'number' ? 'number' : 'text'}
      value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
      className="w-44"
      onChange={(e) => onChange(fieldType === 'number' ? parseFloat(e.target.value) : e.target.value)}
    />
  )
}

// ─── Condition row ────────────────────────────────────────────────────────────

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: SegmentCondition
  onChange: (c: SegmentCondition) => void
  onRemove: () => void
}) {
  const fieldMeta = FIELD_OPTIONS.find((f) => f.value === condition.field)
  const fieldType = fieldMeta?.type ?? 'string'
  const operators = OPERATORS_BY_TYPE[fieldType] ?? []

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <div className="w-56">
        <Select
          value={condition.field}
          onChange={(e) => {
            const newField = e.target.value
            const newType = FIELD_OPTIONS.find((f) => f.value === newField)?.type ?? 'string'
            const firstOp = (OPERATORS_BY_TYPE[newType]?.[0]?.value ?? 'eq') as ConditionOperator
            onChange({ field: newField, operator: firstOp, value: null })
          }}
        >
          {FIELD_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </Select>
      </div>

      <div className="w-44">
        <Select
          value={condition.operator}
          onChange={(e) => onChange({ ...condition, operator: e.target.value as ConditionOperator, value: null })}
        >
          {operators.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
        </Select>
      </div>

      <ValueInput
        field={condition.field}
        fieldType={fieldType}
        operator={condition.operator}
        value={condition.value}
        onChange={(v) => onChange({ ...condition, value: v })}
      />

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Remove condition"
        onClick={onRemove}
      >
        <Icons.X />
      </Button>
    </div>
  )
}

// ─── Group component ──────────────────────────────────────────────────────────

function GroupEditor({
  group,
  depth,
  onChange,
  onRemove,
}: {
  group: SegmentGroup
  depth: number
  onChange: (g: SegmentGroup) => void
  onRemove?: () => void
}) {
  function addCondition() {
    const first = FIELD_OPTIONS[0]!
    const firstOp = OPERATORS_BY_TYPE[first.type]?.[0]?.value as ConditionOperator
    onChange({
      ...group,
      rules: [...group.rules, { field: first.value, operator: firstOp, value: null }],
    })
  }

  function addSubGroup() {
    const first = FIELD_OPTIONS[0]!
    const firstOp = OPERATORS_BY_TYPE[first.type]?.[0]?.value as ConditionOperator
    const sub: SegmentGroup = {
      match: 'any',
      rules: [{ field: first.value, operator: firstOp, value: null }],
    }
    onChange({ ...group, rules: [...group.rules, sub] })
  }

  return (
    <div
      className={
        'mb-2 rounded-lg border border-neutral-200 p-4 ' +
        (depth === 1 ? 'bg-white' : 'bg-neutral-50')
      }
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm text-neutral-600">Match</span>
        <div className="w-44">
          <Select
            value={group.match}
            onChange={(e) => onChange({ ...group, match: e.target.value as 'all' | 'any' })}
          >
            <option value="all">ALL conditions</option>
            <option value="any">ANY condition</option>
          </Select>
        </div>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            leftIcon={<Icons.X />}
            onClick={onRemove}
          >
            Remove group
          </Button>
        )}
      </div>

      {group.rules.map((rule, idx) => {
        if ('field' in rule && !('rules' in rule)) {
          return (
            <ConditionRow
              key={idx}
              condition={rule as SegmentCondition}
              onChange={(c) => {
                const rules = [...group.rules]
                rules[idx] = c
                onChange({ ...group, rules })
              }}
              onRemove={() => onChange({ ...group, rules: group.rules.filter((_, i) => i !== idx) })}
            />
          )
        }
        return (
          <GroupEditor
            key={idx}
            group={rule as SegmentGroup}
            depth={depth + 1}
            onChange={(g) => {
              const rules = [...group.rules]
              rules[idx] = g
              onChange({ ...group, rules })
            }}
            onRemove={() => onChange({ ...group, rules: group.rules.filter((_, i) => i !== idx) })}
          />
        )
      })}

      <div className="mt-2 flex gap-2">
        <Button type="button" variant="ghost" size="sm" leftIcon={<Icons.Plus />} onClick={addCondition}>
          Add condition
        </Button>
        {depth === 1 && (
          <Button type="button" variant="ghost" size="sm" leftIcon={<Icons.Plus />} onClick={addSubGroup}>
            Add group
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── SegmentBuilder (exported) ────────────────────────────────────────────────

interface SegmentBuilderProps {
  initialName?: string
  initialDescription?: string
  initialConditions?: SegmentGroup
  onSave: (name: string, description: string, conditions: SegmentGroup) => Promise<void>
}

export function SegmentBuilder({
  initialName = '',
  initialDescription = '',
  initialConditions,
  onSave,
}: SegmentBuilderProps) {
  const defaultGroup: SegmentGroup = {
    match: 'all',
    rules: [{ field: 'total_orders', operator: 'gt', value: 0 }],
  }

  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [group, setGroup] = useState<SegmentGroup>(initialConditions ?? defaultGroup)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setSaveError('Segment name is required'); return }
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(name.trim(), description.trim(), group)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e) }} className="space-y-6">
      <div className="max-w-md">
        <FormField label="Segment name" error={saveError && !name.trim() ? saveError : undefined}>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. High-Value Lahore Customers"
          />
        </FormField>
      </div>

      <div className="max-w-md">
        <FormField label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional description"
          />
        </FormField>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-neutral-950">Conditions</p>
        <GroupEditor group={group} depth={1} onChange={setGroup} />
      </div>

      {saveError && name.trim() && (
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.AlertCircle className="size-4" />
          {saveError}
        </p>
      )}

      <Button type="submit" isLoading={saving}>
        Save segment
      </Button>
    </form>
  )
}
