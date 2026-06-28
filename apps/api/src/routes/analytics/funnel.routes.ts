import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '@engageiq/db'
import type { FunnelResult, FunnelStepResult } from '@engageiq/shared'
import { resolvePeriod } from './lib/dates.js'
import { computeFunnel } from './lib/clickhouse-analytics.js'

// 4.3 Funnel Analysis. Sequential conversion funnels over ClickHouse events
// (via computeFunnel), period comparison, and saved funnel definitions persisted
// in the Postgres SavedView model (type 'FUNNEL'). Every query is tenant-scoped by
// request.user.merchantId.

// ── Validation schemas ────────────────────────────────────────────────────────

const periodKeySchema = z.enum(['today', '7d', '30d', '90d', 'custom'])

// A single date-range selector (period key or explicit custom range).
const rangeSchema = z.object({
  period: periodKeySchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

const stepsSchema = z
  .array(z.string().trim().min(1, 'step event names must be non-empty'))
  .min(2, 'a funnel needs at least 2 steps')
  .max(10, 'a funnel supports at most 10 steps')

const funnelBodySchema = z.object({
  steps: stepsSchema,
  period: periodKeySchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

const compareBodySchema = z.object({
  steps: stepsSchema,
  a: rangeSchema,
  b: rangeSchema,
})

const savedCreateSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  config: z.unknown(),
})

const savedIdParamsSchema = z.object({
  id: z.string().min(1),
})

type RangeInput = z.infer<typeof rangeSchema>

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a FunnelResult for a single ordered step list over a resolved date range.
 * conversionFromFirst is each step's count over the first step's count; dropOffFromPrev
 * is the fraction lost relative to the immediately preceding step; overallConversion is
 * last/first. All ratios are 0 when the divisor is 0 (no division by zero).
 */
async function buildFunnel(
  merchantId: string,
  steps: string[],
  range: { period?: RangeInput['period']; from?: string; to?: string },
): Promise<FunnelResult> {
  const { from, to } = resolvePeriod({
    period: range.period,
    fromIso: range.from,
    toIso: range.to,
  })

  const counts = await computeFunnel(merchantId, steps, from, to)

  const first = counts[0] ?? 0
  const last = counts[counts.length - 1] ?? 0

  const stepResults: FunnelStepResult[] = steps.map((step, i) => {
    const count = counts[i] ?? 0
    const prev = i === 0 ? count : counts[i - 1] ?? 0
    return {
      step,
      count,
      conversionFromFirst: first > 0 ? count / first : 0,
      dropOffFromPrev: i === 0 ? 0 : prev > 0 ? (prev - count) / prev : 0,
    }
  })

  return {
    steps: stepResults,
    totalEntered: first,
    overallConversion: first > 0 ? last / first : 0,
    from: from.toISOString(),
    to: to.toISOString(),
  }
}

async function sendValidationError(reply: FastifyReply, err: z.ZodError): Promise<void> {
  await reply.status(400).send({
    success: false,
    error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.flatten() },
  })
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function funnelHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = funnelBodySchema.safeParse(request.body)
  if (!parsed.success) return sendValidationError(reply, parsed.error)

  try {
    const data = await buildFunnel(request.user.merchantId, parsed.data.steps, {
      period: parsed.data.period,
      from: parsed.data.from,
      to: parsed.data.to,
    })
    await reply.send({ success: true, data })
  } catch (err) {
    request.log.error({ err }, 'Failed to compute funnel')
    await reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to compute funnel' },
    })
  }
}

async function funnelCompareHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = compareBodySchema.safeParse(request.body)
  if (!parsed.success) return sendValidationError(reply, parsed.error)

  try {
    const merchantId = request.user.merchantId
    const [a, b] = await Promise.all([
      buildFunnel(merchantId, parsed.data.steps, parsed.data.a),
      buildFunnel(merchantId, parsed.data.steps, parsed.data.b),
    ])
    await reply.send({ success: true, data: { a, b } })
  } catch (err) {
    request.log.error({ err }, 'Failed to compare funnels')
    await reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to compare funnels' },
    })
  }
}

async function listSavedHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const views = await prisma.savedView.findMany({
      where: { merchantId: request.user.merchantId, type: 'FUNNEL' },
      orderBy: { createdAt: 'desc' },
    })
    await reply.send({ success: true, data: views })
  } catch (err) {
    request.log.error({ err }, 'Failed to list saved funnels')
    await reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to list saved funnels' },
    })
  }
}

async function createSavedHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = savedCreateSchema.safeParse(request.body)
  if (!parsed.success) return sendValidationError(reply, parsed.error)

  try {
    const view = await prisma.savedView.create({
      data: {
        merchantId: request.user.merchantId,
        type: 'FUNNEL',
        name: parsed.data.name,
        config: (parsed.data.config ?? {}) as object,
      },
    })
    await reply.status(201).send({ success: true, data: view })
  } catch (err) {
    request.log.error({ err }, 'Failed to create saved funnel')
    await reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create saved funnel' },
    })
  }
}

async function deleteSavedHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = savedIdParamsSchema.safeParse(request.params)
  if (!parsed.success) return sendValidationError(reply, parsed.error)

  try {
    // deleteMany with the merchant filter keeps the delete tenant-safe.
    const result = await prisma.savedView.deleteMany({
      where: { id: parsed.data.id, merchantId: request.user.merchantId, type: 'FUNNEL' },
    })
    if (result.count === 0) {
      await reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Saved funnel not found' },
      })
      return
    }
    await reply.send({ success: true, data: { id: parsed.data.id } })
  } catch (err) {
    request.log.error({ err }, 'Failed to delete saved funnel')
    await reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to delete saved funnel' },
    })
  }
}

const funnelRoutes: FastifyPluginAsync = async (fastify) => {
  // Specific/static paths first, wildcards last (route-ordering rule).
  fastify.post('/funnel', funnelHandler)
  fastify.post('/funnel/compare', funnelCompareHandler)

  fastify.get('/funnel/saved', listSavedHandler)
  fastify.post('/funnel/saved', createSavedHandler)
  fastify.delete('/funnel/saved/:id', deleteSavedHandler)
}

export default funnelRoutes
