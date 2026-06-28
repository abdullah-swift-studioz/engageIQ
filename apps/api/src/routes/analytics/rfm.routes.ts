import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '@engageiq/db'
import type { RfmDashboard, RfmSegmentSize, RfmTrendPoint } from '@engageiq/shared'

// 4.2 RFM dashboard VIEW (read-only). The RFM scoring engine itself belongs to the ML lane,
// which writes customers.rfm_segment / rfm_*_score / rfm_scored_at. This view only reads
// those columns and is fully null-safe (empty result before any scoring has run).

async function buildRfmDashboard(merchantId: string): Promise<RfmDashboard> {
  const [totalCustomers, grouped, trendRows] = await Promise.all([
    prisma.customer.count({ where: { merchantId } }),
    prisma.customer.groupBy({
      by: ['rfmSegment'],
      where: { merchantId, rfmSegment: { not: null } },
      _count: { _all: true },
    }),
    // Snapshot distribution by scoring date (last 90 days). Empty until the ML lane scores.
    prisma.$queryRaw<{ date: string; segment: string; count: number }[]>`
      SELECT to_char(date_trunc('day', rfm_scored_at), 'YYYY-MM-DD') AS date,
             rfm_segment::text AS segment,
             count(*)::int AS count
      FROM customers
      WHERE merchant_id = ${merchantId}
        AND rfm_segment IS NOT NULL
        AND rfm_scored_at IS NOT NULL
        AND rfm_scored_at >= now() - interval '90 days'
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `,
  ])

  const totalScored = grouped.reduce((sum, g) => sum + g._count._all, 0)

  const segments: RfmSegmentSize[] = grouped
    .filter((g) => g.rfmSegment != null)
    .map((g) => ({
      segment: g.rfmSegment as string,
      count: g._count._all,
      pctOfBase: totalCustomers > 0 ? g._count._all / totalCustomers : 0,
    }))
    .sort((a, b) => b.count - a.count)

  const trend: RfmTrendPoint[] = trendRows.map((r) => ({
    date: r.date,
    segment: r.segment,
    count: Number(r.count),
  }))

  return {
    totalCustomers,
    totalScored,
    segments,
    trend,
    generatedAt: new Date().toISOString(),
  }
}

async function rfmHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = request.user.merchantId
  try {
    const dashboard = await buildRfmDashboard(merchantId)
    await reply.send({ success: true, data: dashboard })
  } catch (err) {
    request.log.error({ err }, 'Failed to build RFM dashboard')
    await reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to build RFM dashboard' },
    })
  }
}

const rfmRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/rfm', rfmHandler)
}

export default rfmRoutes
