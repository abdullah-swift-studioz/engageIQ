import { useState } from 'react'
import {
  Card,
  CardContent,
  SectionHeader,
  FormField,
  Input,
  Textarea,
  Select,
  Checkbox,
} from '~/components/ui'
import {
  TYPE_OPTIONS,
  STATUS_OPTIONS,
  TRIGGER_OPTIONS,
  FREQUENCY_OPTIONS,
  POSITION_OPTIONS,
} from './constants'
import type { ElementDetail, SegmentOption } from './api.server'

interface ElementFormProps {
  element?: ElementDetail | null
  segments: SegmentOption[]
}

/**
 * The create/edit form body. Uncontrolled fields (defaultValue) with a little
 * local state to show only the inputs relevant to the chosen type + trigger.
 * The parent route wraps this in a Remix <Form>; the action assembles the nested
 * `config` / `displayRules` JSON from the flat field names.
 */
export function ElementForm({ element, segments }: ElementFormProps) {
  const [type, setType] = useState(element?.type ?? 'POPUP')
  const [trigger, setTrigger] = useState(element?.displayRules?.trigger ?? 'timed')
  const cfg = element?.config ?? {}
  const rules = element?.displayRules

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <SectionHeader title="Basics" />
          <FormField label="Name" required>
            <Input name="name" defaultValue={element?.name ?? ''} placeholder="Welcome offer popup" required />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Type">
              <Select name="type" defaultValue={type} onChange={(e) => setType(e.target.value as typeof type)}>
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Status">
              <Select name="status" defaultValue={element?.status ?? 'DRAFT'}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Audience" hint="Who sees this element.">
              <Select name="segmentId" defaultValue={element?.segmentId ?? ''}>
                <option value="">All visitors</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Priority" hint="Lower shows first when several match.">
              <Input name="priority" type="number" defaultValue={element?.priority ?? ''} placeholder="0" />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <SectionHeader title="Trigger" />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="When to show">
              <Select
                name="trigger"
                defaultValue={trigger}
                onChange={(e) => setTrigger(e.target.value as typeof trigger)}
              >
                {TRIGGER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Frequency">
              <Select name="frequency" defaultValue={rules?.frequency ?? 'once_per_session'}>
                {FREQUENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          {trigger === 'timed' && (
            <FormField label="Delay (seconds)">
              <Input name="timedDelaySeconds" type="number" defaultValue={rules?.timedDelaySeconds ?? 5} />
            </FormField>
          )}
          {trigger === 'cart_value' && (
            <FormField label="Cart value threshold (PKR)">
              <Input name="cartValueThreshold" type="number" defaultValue={rules?.cartValueThreshold ?? 0} />
            </FormField>
          )}
          <FormField label="Page path contains" hint="Optional — e.g. /products. Blank = every page.">
            <Input name="pagePattern" defaultValue={rules?.pagePattern ?? ''} placeholder="/products" />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <SectionHeader title="Content" />
          <FormField label="Headline" hint="Tokens like {{customer.first_name}} are personalized.">
            <Input name="cfg_headline" defaultValue={cfg.headline ?? ''} placeholder="Welcome back!" />
          </FormField>
          <FormField label="Body">
            <Textarea name="cfg_body" rows={3} defaultValue={cfg.body ?? ''} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Button text">
              <Input name="cfg_ctaText" defaultValue={cfg.ctaText ?? ''} placeholder="Shop now" />
            </FormField>
            <FormField label="Button URL">
              <Input name="cfg_ctaUrl" defaultValue={cfg.ctaUrl ?? ''} placeholder="/collections/sale" />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Incentive code" hint="Revealed when the visitor clicks the button.">
              <Input name="cfg_incentiveCode" defaultValue={cfg.incentiveCode ?? ''} placeholder="SAVE10" />
            </FormField>
            <FormField label="Image URL">
              <Input name="cfg_imageUrl" defaultValue={cfg.imageUrl ?? ''} />
            </FormField>
          </div>
          {type !== 'EMBED' && (
            <FormField label="Position">
              <Select name="cfg_position" defaultValue={cfg.position ?? 'center'}>
                {POSITION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          {type === 'EMBED' && (
            <FormField label="Embed selector" hint="CSS selector on the storefront to inject into.">
              <Input name="cfg_embedSelector" defaultValue={cfg.embedSelector ?? ''} placeholder=".product-form" />
            </FormField>
          )}
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <Checkbox name="cfg_dismissible" defaultChecked={cfg.dismissible !== false} />
            Dismissible (show a close button)
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <Checkbox name="cfg_captureEmail" defaultChecked={cfg.captureEmail === true} />
            Capture email (adds an email field to the popup)
          </label>
        </CardContent>
      </Card>
    </div>
  )
}
