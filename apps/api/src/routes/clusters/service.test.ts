import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@engageiq/db', () => {
  const tx = {
    segment: { create: vi.fn() },
    segmentMembership: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  }
  return {
    prisma: {
      modelRun: { findFirst: vi.fn() },
      customer: { findMany: vi.fn() },
      segment: { create: vi.fn() },
      segmentMembership: { createMany: vi.fn() },
      // $transaction here runs the callback with the tx stub
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  }
})

import { prisma } from '@engageiq/db'
import { getLatestClusters, promoteCluster, PromoteError } from './service.js'

const tx = (prisma as unknown as { __tx: { segment: { create: any }; segmentMembership: { createMany: any } } })
  .__tx

const RUN = {
  id: 'run1',
  merchantId: 'm1',
  modelName: 'segment-discovery',
  runAt: new Date('2026-07-03T00:00:00Z'),
  metadata: {
    silhouette: 0.42,
    clusters: [
      {
        index: 0,
        label: 'High Value Loyalists',
        size: 2,
        avgLtv: 12000,
        avgRecencyDays: 5,
        avgFrequency: 4,
        avgMonetary: 40000,
        description: 'Frequent high spenders',
        recommendedAction: 'VIP treatment',
        customerIds: ['c1', 'c2'],
      },
    ],
  },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getLatestClusters', () => {
  it('maps the latest run metadata to cluster views', async () => {
    ;(prisma.modelRun.findFirst as any).mockResolvedValue(RUN)
    const out = await getLatestClusters('m1')
    expect(out.runId).toBe('run1')
    expect(out.silhouette).toBe(0.42)
    expect(out.clusters).toHaveLength(1)
    expect(out.clusters[0]).toMatchObject({ index: 0, label: 'High Value Loyalists', customerCount: 2 })
  })

  it('returns an empty result when no discovery run exists', async () => {
    ;(prisma.modelRun.findFirst as any).mockResolvedValue(null)
    const out = await getLatestClusters('m1')
    expect(out).toEqual({ runId: null, runAt: null, silhouette: null, clusters: [] })
  })
})

describe('promoteCluster', () => {
  it('creates a static segment + membership snapshot from live customers', async () => {
    ;(prisma.modelRun.findFirst as any).mockResolvedValue(RUN)
    ;(prisma.customer.findMany as any).mockResolvedValue([{ id: 'c1' }, { id: 'c2' }])
    ;(tx.segment.create as any).mockResolvedValue({ id: 'seg1', name: 'High Value Loyalists' })

    const res = await promoteCluster('m1', 'run1', 0, {})

    expect(res).toEqual({ segmentId: 'seg1', name: 'High Value Loyalists', memberCount: 2 })
    // static segment with provenance
    expect(tx.segment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          merchantId: 'm1',
          isDynamic: false,
          memberCount: 2,
          conditions: expect.objectContaining({ _source: 'ai-cluster', modelRunId: 'run1', clusterIndex: 0 }),
        }),
      }),
    )
    expect(tx.segmentMembership.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ segmentId: 'seg1', customerId: 'c1' }),
        expect.objectContaining({ segmentId: 'seg1', customerId: 'c2' }),
      ],
    })
  })

  it('only materialises customers that are still live + tenant-owned', async () => {
    ;(prisma.modelRun.findFirst as any).mockResolvedValue(RUN)
    // c2 merged/removed → only c1 comes back
    ;(prisma.customer.findMany as any).mockResolvedValue([{ id: 'c1' }])
    ;(tx.segment.create as any).mockResolvedValue({ id: 'seg1', name: 'X' })
    const res = await promoteCluster('m1', 'run1', 0, { name: 'X' })
    expect(res.memberCount).toBe(1)
  })

  it('throws RUN_NOT_FOUND for an unknown run', async () => {
    ;(prisma.modelRun.findFirst as any).mockResolvedValue(null)
    await expect(promoteCluster('m1', 'nope', 0, {})).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' })
  })

  it('throws CLUSTER_NOT_FOUND for a bad index', async () => {
    ;(prisma.modelRun.findFirst as any).mockResolvedValue(RUN)
    await expect(promoteCluster('m1', 'run1', 9, {})).rejects.toMatchObject({ code: 'CLUSTER_NOT_FOUND' })
  })

  it('throws NO_MEMBERS when no live customers remain', async () => {
    ;(prisma.modelRun.findFirst as any).mockResolvedValue(RUN)
    ;(prisma.customer.findMany as any).mockResolvedValue([])
    await expect(promoteCluster('m1', 'run1', 0, {})).rejects.toBeInstanceOf(PromoteError)
  })
})
