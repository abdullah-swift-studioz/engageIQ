import * as React from 'react'
import { useFetcher } from '@remix-run/react'
import type { SubjectPredictResultDto } from '@engageiq/shared'
import { Button, Input, Badge, Icons, cn } from '~/components/ui'

type PredictFetcherData =
  | { success: true; data: SubjectPredictResultDto }
  | { success: false; error: { code: string; message: string } }

const CONFIDENCE_LABEL: Record<SubjectPredictResultDto['confidence'], string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

// Presentational readout for one prediction — reused by the copywriter panel too.
export function PredictionReadout({ result }: { result: SubjectPredictResultDto }) {
  const pct = Math.round(result.predictedOpenRate * 100)
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-2xs font-medium uppercase tracking-wide text-neutral-500">
            Predicted open rate
          </div>
          <div className="tabular text-3xl font-semibold text-neutral-950">{pct}%</div>
        </div>
        <Badge variant="subtle">{CONFIDENCE_LABEL[result.confidence]}</Badge>
      </div>
      <ul className="mt-3 space-y-1.5">
        {result.factors.map((f, i) => {
          const Icon =
            f.impact === 'positive'
              ? Icons.CheckCircle
              : f.impact === 'negative'
                ? Icons.AlertCircle
                : Icons.Info
          return (
            <li key={i} className="flex items-start gap-2 text-sm">
              <Icon
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  f.impact === 'negative' ? 'text-neutral-900' : 'text-neutral-500',
                )}
              />
              <span className="text-neutral-600">
                <span className="font-medium text-neutral-900">{f.label}.</span> {f.detail}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export interface SubjectOpenRatePredictorProps {
  /** Optional starting subject; the input is otherwise self-managed. */
  initialSubject?: string
  className?: string
}

// Standalone subject-line open-rate predictor. Embeddable next to any email subject field.
export function SubjectOpenRatePredictor({ initialSubject = '', className }: SubjectOpenRatePredictorProps) {
  const [subject, setSubject] = React.useState(initialSubject)
  const fetcher = useFetcher<PredictFetcherData>()
  const busy = fetcher.state !== 'idle'

  React.useEffect(() => {
    setSubject(initialSubject)
  }, [initialSubject])

  function predict() {
    if (!subject.trim()) return
    fetcher.submit(
      { subject },
      { method: 'post', action: '/api/ai/predict-subject', encType: 'application/json' },
    )
  }

  const data = fetcher.data

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-end gap-2">
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Enter an email subject line…"
          aria-label="Email subject line"
        />
        <Button variant="secondary" onClick={predict} isLoading={busy} disabled={!subject.trim()}>
          Predict
        </Button>
      </div>
      {data && data.success && <PredictionReadout result={data.data} />}
      {data && !data.success && (
        <p className="flex items-center gap-2 text-sm text-neutral-600">
          <Icons.AlertTriangle className="size-4" />
          {data.error.message}
        </p>
      )}
    </div>
  )
}
