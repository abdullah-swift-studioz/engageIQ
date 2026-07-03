import { useEffect, useMemo, useRef, useState } from 'react'
import { useFetcher } from '@remix-run/react'
import type { EmailBlock } from '@engageiq/shared'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Label,
  FormField,
  Badge,
  Switch,
  Icons,
  SectionHeader,
  useToast,
} from '~/components/ui'
import { BLOCK_PALETTE, createBlock, move, type BlockType } from './blocks'
import { BlockCard } from './BlockCard'

export interface EmailTemplateData {
  id: string
  name: string
  subject: string | null
  preheader: string | null
  blocks: EmailBlock[]
  status: string
  isTransactional: boolean
}

interface SegmentOption {
  id: string
  name: string
}

interface SpamIssue {
  id: string
  severity: 'high' | 'medium' | 'low'
  message: string
}
interface PreviewResponse {
  html?: string
  subject?: string
  spam?: { score: number; rating: 'good' | 'fair' | 'poor'; issues: SpamIssue[] }
  saved?: boolean
  sent?: { enqueued: number } | { ok: boolean; error?: string }
  error?: string
}

interface EmailBuilderProps {
  template: EmailTemplateData
  segments: SegmentOption[]
}

export function EmailBuilder({ template, segments }: EmailBuilderProps) {
  const { toast } = useToast()
  const [name, setName] = useState(template.name)
  const [subject, setSubject] = useState(template.subject ?? '')
  const [preheader, setPreheader] = useState(template.preheader ?? '')
  const [isTransactional, setIsTransactional] = useState(template.isTransactional)
  const [blocks, setBlocks] = useState<EmailBlock[]>(template.blocks ?? [])
  const [mobile, setMobile] = useState(false)
  const dragIndex = useRef<number | null>(null)

  const previewFetcher = useFetcher<PreviewResponse>()
  const saveFetcher = useFetcher<PreviewResponse>()
  const sendFetcher = useFetcher<PreviewResponse>()
  const testFetcher = useFetcher<PreviewResponse>()

  const serialized = useMemo(
    () => JSON.stringify({ name, subject, preheader, isTransactional, status: template.status, blocks }),
    [name, subject, preheader, isTransactional, template.status, blocks],
  )

  // Auto-save + re-render preview shortly after edits settle (autosave keeps the stored
  // template in sync so the server-side render reflects the latest blocks).
  useEffect(() => {
    const t = setTimeout(() => {
      previewFetcher.submit({ intent: 'preview', payload: serialized }, { method: 'post' })
    }, 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized])

  const preview = previewFetcher.data
  const html = preview?.html ?? ''
  const spam = preview?.spam

  function addBlock(type: BlockType) {
    setBlocks((b) => [...b, createBlock(type)])
  }
  function updateBlock(i: number, next: EmailBlock) {
    setBlocks((b) => b.map((x, j) => (j === i ? next : x)))
  }
  function deleteBlock(i: number) {
    setBlocks((b) => b.filter((_, j) => j !== i))
  }

  function save() {
    saveFetcher.submit({ intent: 'save', payload: serialized }, { method: 'post' })
  }

  // Toast on save / send completion.
  useEffect(() => {
    if (saveFetcher.state === 'idle' && saveFetcher.data?.saved) toast({ title: 'Saved', variant: 'success' })
  }, [saveFetcher.state, saveFetcher.data, toast])
  useEffect(() => {
    if (sendFetcher.state === 'idle' && sendFetcher.data?.sent) {
      const s = sendFetcher.data.sent
      if ('enqueued' in s) toast({ title: `Queued ${s.enqueued} email${s.enqueued === 1 ? '' : 's'}`, variant: 'success' })
    }
  }, [sendFetcher.state, sendFetcher.data, toast])
  useEffect(() => {
    if (testFetcher.state === 'idle' && testFetcher.data?.sent) {
      const s = testFetcher.data.sent as { ok?: boolean; error?: string }
      toast(
        s.ok
          ? { title: 'Test email sent', variant: 'success' }
          : { title: 'Test send not delivered', description: s.error, variant: 'error' },
      )
    }
  }, [testFetcher.state, testFetcher.data, toast])

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* ─── Editor column ─────────────────────────────────────────────── */}
      <div className="lg:w-[46%] lg:min-w-[380px] space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField label="Template name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Subject line" hint="Personalization tokens work here, e.g. {{customer.first_name}}.">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Your weekly picks are here" />
            </FormField>
            <FormField label="Preheader" hint="Preview text shown after the subject in the inbox.">
              <Input value={preheader} onChange={(e) => setPreheader(e.target.value)} />
            </FormField>
            <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2">
              <div>
                <Label>Transactional</Label>
                <p className="text-sm text-neutral-500">Order/shipping emails — bypasses marketing suppression.</p>
              </div>
              <Switch checked={isTransactional} onCheckedChange={setIsTransactional} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Content blocks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {BLOCK_PALETTE.map((p) => (
                <Button key={p.type} variant="secondary" size="sm" leftIcon={<Icons.Plus className="size-4" />} onClick={() => addBlock(p.type)}>
                  {p.label}
                </Button>
              ))}
            </div>

            {blocks.length === 0 && (
              <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
                No blocks yet. Add text, images, buttons, a live product grid, or segment-conditional content above.
              </p>
            )}

            <div className="space-y-2">
              {blocks.map((block, i) => (
                <BlockCard
                  key={block.id}
                  block={block}
                  index={i}
                  count={blocks.length}
                  segments={segments}
                  onChange={(next) => updateBlock(i, next)}
                  onDelete={() => deleteBlock(i)}
                  onMove={(from, to) => setBlocks((b) => move(b, from, to))}
                  onDragStart={() => (dragIndex.current = i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex.current !== null) setBlocks((b) => move(b, dragIndex.current as number, i))
                    dragIndex.current = null
                  }}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <SendPanel
          segments={segments}
          onSend={(segmentId) => sendFetcher.submit({ intent: 'send', segmentId }, { method: 'post' })}
          onTest={(toEmail) => testFetcher.submit({ intent: 'test', toEmail }, { method: 'post' })}
          sending={sendFetcher.state !== 'idle'}
          testing={testFetcher.state !== 'idle'}
        />
      </div>

      {/* ─── Preview column ────────────────────────────────────────────── */}
      <div className="lg:flex-1">
        <div className="sticky top-4 space-y-3">
          <div className="flex items-center justify-between">
            <SectionHeader title="Preview" />
            <div className="flex items-center gap-2">
              {spam && <SpamBadge score={spam.score} rating={spam.rating} />}
              <div className="flex rounded-lg border border-neutral-200 p-0.5">
                <Button variant={mobile ? 'ghost' : 'secondary'} size="sm" onClick={() => setMobile(false)}>
                  Desktop
                </Button>
                <Button variant={mobile ? 'secondary' : 'ghost'} size="sm" onClick={() => setMobile(true)}>
                  Mobile
                </Button>
              </div>
              <Button size="sm" isLoading={saveFetcher.state !== 'idle'} onClick={save}>
                Save
              </Button>
            </div>
          </div>

          <div className="flex justify-center rounded-lg border border-neutral-200 bg-neutral-100 p-4">
            <iframe
              title="Email preview"
              srcDoc={html || '<p style="font-family:sans-serif;color:#999;padding:40px;text-align:center;">Rendering…</p>'}
              className="h-[70vh] rounded-md border border-neutral-200 bg-white transition-all"
              style={{ width: mobile ? 375 : '100%', maxWidth: mobile ? 375 : 680 }}
            />
          </div>

          {spam && spam.issues.length > 0 && <SpamIssues issues={spam.issues} />}
        </div>
      </div>
    </div>
  )
}

function SpamBadge({ score, rating }: { score: number; rating: 'good' | 'fair' | 'poor' }) {
  const icon =
    rating === 'good' ? <Icons.CheckCircle className="size-4" /> : rating === 'fair' ? <Icons.AlertCircle className="size-4" /> : <Icons.AlertTriangle className="size-4" />
  return (
    <Badge variant={rating === 'good' ? 'subtle' : 'outline'}>
      <span className="inline-flex items-center gap-1">
        {icon} Spam {score}/100
      </span>
    </Badge>
  )
}

function SpamIssues({ issues }: { issues: SpamIssue[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Deliverability checks</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {issues.map((i) => (
          <div key={i.id} className="flex items-start gap-2 text-sm">
            {i.severity === 'high' ? (
              <Icons.AlertTriangle className="mt-0.5 size-4 shrink-0 text-neutral-900" />
            ) : (
              <Icons.AlertCircle className="mt-0.5 size-4 shrink-0 text-neutral-500" />
            )}
            <span className="text-neutral-700">
              <span className="font-medium uppercase text-2xs tracking-wide text-neutral-500">{i.severity}</span> — {i.message}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function SendPanel({
  segments,
  onSend,
  onTest,
  sending,
  testing,
}: {
  segments: SegmentOption[]
  onSend: (segmentId: string) => void
  onTest: (toEmail: string) => void
  sending: boolean
  testing: boolean
}) {
  const [segmentId, setSegmentId] = useState('')
  const [testEmail, setTestEmail] = useState('')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test &amp; send</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <FormField label="Send a test to">
              <Input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@store.com" />
            </FormField>
          </div>
          <Button variant="secondary" isLoading={testing} disabled={!testEmail} onClick={() => onTest(testEmail)}>
            Send test
          </Button>
        </div>

        <div className="flex items-end gap-2 border-t border-neutral-200 pt-4">
          <div className="flex-1">
            <FormField label="Send to segment">
              <Select value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
                <option value="">Choose a segment…</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <Button isLoading={sending} disabled={!segmentId} onClick={() => onSend(segmentId)}>
            Send campaign
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
