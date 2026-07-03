import * as React from 'react'
import { useFetcher } from '@remix-run/react'
import type {
  AiGenerateResultDto,
  ChannelName,
  CopyLanguage,
  CopyPurpose,
  CopyTone,
  SubjectPredictResultDto,
} from '@engageiq/shared'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Textarea,
  Select,
  Badge,
  Icons,
  useToast,
  cn,
} from '~/components/ui'
import { PredictionReadout } from './SubjectOpenRatePredictor'

type GenerateFetcherData =
  | { success: true; data: AiGenerateResultDto }
  | { success: false; error: { code: string; message: string } }

type PredictFetcherData =
  | { success: true; data: SubjectPredictResultDto }
  | { success: false; error: { code: string; message: string } }

const PURPOSE_LABEL: Record<CopyPurpose, string> = {
  email_subject: 'Email subject line',
  whatsapp_body: 'WhatsApp message',
  sms_copy: 'SMS',
}

const PURPOSE_CHANNEL: Record<CopyPurpose, ChannelName> = {
  email_subject: 'EMAIL',
  whatsapp_body: 'WHATSAPP',
  sms_copy: 'SMS',
}

const TONES: CopyTone[] = ['friendly', 'casual', 'formal', 'urgent']

export interface GenerateWithAiPanelProps {
  /** What kind of copy to write. When omitted a purpose selector is shown. */
  purpose?: CopyPurpose
  /** Prefill the goal (e.g. "cart recovery" for an abandoned-cart flow step). */
  defaultGoal?: string
  /** Prefill the target segment name. */
  defaultSegment?: string
  /** Called when the merchant picks a variant — wire this into your editor's field. */
  onSelect?: (text: string) => void
  className?: string
}

// Reusable "Generate with AI" panel. Drop it into a campaign or flow-step editor and pass a
// `purpose` + `onSelect`. Fully monochrome (design system); all AI calls proxy through the
// /api/ai/* resource routes.
export function GenerateWithAiPanel({
  purpose: purposeProp,
  defaultGoal = '',
  defaultSegment = '',
  onSelect,
  className,
}: GenerateWithAiPanelProps) {
  const { toast } = useToast()
  const [purpose, setPurpose] = React.useState<CopyPurpose>(purposeProp ?? 'email_subject')
  const [goal, setGoal] = React.useState(defaultGoal)
  const [segment, setSegment] = React.useState(defaultSegment)
  const [offer, setOffer] = React.useState('')
  const [tone, setTone] = React.useState<CopyTone>('friendly')
  const [language, setLanguage] = React.useState<CopyLanguage>('en')
  const [count, setCount] = React.useState(3)

  const effectivePurpose = purposeProp ?? purpose

  const generate = useFetcher<GenerateFetcherData>()
  const busy = generate.state !== 'idle'

  // Per-variant open-rate prediction (email subjects only).
  const predict = useFetcher<PredictFetcherData>()
  const [predictIndex, setPredictIndex] = React.useState<number | null>(null)
  const [predictions, setPredictions] = React.useState<Record<number, SubjectPredictResultDto>>({})

  React.useEffect(() => {
    if (predict.state === 'idle' && predict.data && predictIndex !== null) {
      if (predict.data.success) {
        const result = predict.data.data
        setPredictions((prev) => ({ ...prev, [predictIndex]: result }))
      }
      setPredictIndex(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predict.state, predict.data])

  function runGenerate() {
    if (!goal.trim()) return
    setPredictions({})
    // Build context with only defined keys (JSON submit rejects `undefined`-valued props).
    const context: Record<string, string> = { goal: goal.trim(), tone, language }
    if (segment.trim()) context.segment = segment.trim()
    if (offer.trim()) context.offer = offer.trim()
    generate.submit(
      { purpose: effectivePurpose, channel: PURPOSE_CHANNEL[effectivePurpose], count, context },
      { method: 'post', action: '/api/ai/generate', encType: 'application/json' },
    )
  }

  function predictVariant(index: number, text: string) {
    setPredictIndex(index)
    predict.submit(
      { subject: text },
      { method: 'post', action: '/api/ai/predict-subject', encType: 'application/json' },
    )
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: 'Copied to clipboard', variant: 'success' })
    } catch {
      toast({ title: 'Could not copy', variant: 'error' })
    }
  }

  const result = generate.data

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icons.Sparkles className="size-4" />
          Generate with AI
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!purposeProp && (
          <FormField label="What are you writing?">
            <Select value={purpose} onChange={(e) => setPurpose(e.target.value as CopyPurpose)}>
              {(Object.keys(PURPOSE_LABEL) as CopyPurpose[]).map((p) => (
                <option key={p} value={p}>
                  {PURPOSE_LABEL[p]}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        <FormField label="Campaign goal" hint="e.g. cart recovery, win-back, promotion">
          <Textarea
            rows={2}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Recover abandoned carts with a friendly nudge"
          />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Target segment" hint="Optional">
            <Input
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
              placeholder="VIP customers"
            />
          </FormField>
          <FormField label="Offer" hint="Optional">
            <Input value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="15% off, code SAVE15" />
          </FormField>
          <FormField label="Tone">
            <Select value={tone} onChange={(e) => setTone(e.target.value as CopyTone)}>
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Language">
            <Select value={language} onChange={(e) => setLanguage(e.target.value as CopyLanguage)}>
              <option value="en">English</option>
              <option value="ur">Urdu</option>
            </Select>
          </FormField>
        </div>

        <div className="flex items-center justify-between gap-3">
          <FormField label="Variants" className="w-28">
            <Select value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </FormField>
          <Button
            onClick={runGenerate}
            isLoading={busy}
            disabled={!goal.trim()}
            leftIcon={<Icons.Sparkles className="size-4" />}
          >
            {result?.success ? 'Regenerate' : 'Generate'}
          </Button>
        </div>

        {result && !result.success && (
          <p className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
            <Icons.AlertTriangle className="size-4 shrink-0" />
            {result.error.message}
          </p>
        )}

        {result && result.success && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-2xs uppercase tracking-wide text-neutral-500">
              <span>{PURPOSE_LABEL[result.data.purpose]} · {result.data.variants.length} variants</span>
              <span className="tabular">
                {result.data.usage.promptTokens + result.data.usage.completionTokens} tokens · $
                {result.data.usage.costUsd.toFixed(4)}
              </span>
            </div>

            <ul className="space-y-2" dir={result.data.language === 'ur' ? 'rtl' : 'ltr'}>
              {result.data.variants.map((v, i) => {
                const prediction = predictions[i]
                return (
                  <li key={i} className="rounded-lg border border-neutral-200 p-3">
                    <p className="text-sm text-neutral-950">{v.text}</p>
                    {v.rationale && <p className="mt-1 text-xs text-neutral-500">{v.rationale}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {onSelect && (
                        <Button size="sm" variant="secondary" onClick={() => onSelect(v.text)}>
                          Use this
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => copy(v.text)}>
                        Copy
                      </Button>
                      {result.data.purpose === 'email_subject' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => predictVariant(i, v.text)}
                          isLoading={predict.state !== 'idle' && predictIndex === i}
                          leftIcon={<Icons.BarChart className="size-4" />}
                        >
                          Predict open rate
                        </Button>
                      )}
                      {prediction && (
                        <Badge variant="subtle">
                          {Math.round(prediction.predictedOpenRate * 100)}% predicted
                        </Badge>
                      )}
                    </div>
                    {prediction && (
                      <div className="mt-3" dir="ltr">
                        <PredictionReadout result={prediction} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
