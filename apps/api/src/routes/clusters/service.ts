// AI segment-discovery clusters → official Segment promotion (roadmap 5.3).
//
// The scoring worker (lane:ml) records discovered clusters in ModelRun.metadata for
// modelName='segment-discovery'. This service exposes the latest run's clusters and
// promotes a chosen cluster into a real (static) Segment with a materialised membership
// snapshot. Every query is tenant-scoped by merchantId.

import { prisma } from '@engageiq/db'
import { Prisma } from '@prisma/client'

export interface ClusterView {
  index: number
  label: string
  size: number
  avgLtv: number
  avgRecencyDays: number
  avgFrequency: number
  avgMonetary: number
  description: string
  recommendedAction: string
  customerCount: number
}

interface StoredCluster {
  index?: number
  label?: string
  size?: number
  avgLtv?: number
  avgRecencyDays?: number
  avgFrequency?: number
  avgMonetary?: number
  description?: string
  recommendedAction?: string
  customerIds?: string[]
}

interface DiscoveryMetadata {
  silhouette?: number | null
  clusters?: StoredCluster[]
}

function parseClusters(metadata: Prisma.JsonValue | null): StoredCluster[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return []
  const clusters = (metadata as DiscoveryMetadata).clusters
  return Array.isArray(clusters) ? clusters : []
}

function toView(c: StoredCluster, fallbackIndex: number): ClusterView {
  return {
    index: c.index ?? fallbackIndex,
    label: c.label ?? `Cluster ${c.index ?? fallbackIndex}`,
    size: c.size ?? c.customerIds?.length ?? 0,
    avgLtv: c.avgLtv ?? 0,
    avgRecencyDays: c.avgRecencyDays ?? 0,
    avgFrequency: c.avgFrequency ?? 0,
    avgMonetary: c.avgMonetary ?? 0,
    description: c.description ?? '',
    recommendedAction: c.recommendedAction ?? '',
    customerCount: c.customerIds?.length ?? 0,
  }
}

export interface LatestClusters {
  runId: string | null
  runAt: Date | null
  silhouette: number | null
  clusters: ClusterView[]
}

/** Latest segment-discovery run's clusters for this merchant (for the clusters UI). */
export async function getLatestClusters(merchantId: string): Promise<LatestClusters> {
  const run = await prisma.modelRun.findFirst({
    where: { merchantId, modelName: 'segment-discovery' },
    orderBy: { runAt: 'desc' },
  })
  if (!run) return { runId: null, runAt: null, silhouette: null, clusters: [] }

  const meta = (run.metadata && typeof run.metadata === 'object' && !Array.isArray(run.metadata)
    ? (run.metadata as DiscoveryMetadata)
    : {}) as DiscoveryMetadata
  const clusters = parseClusters(run.metadata).map(toView)
  return {
    runId: run.id,
    runAt: run.runAt,
    silhouette: typeof meta.silhouette === 'number' ? meta.silhouette : null,
    clusters,
  }
}

export class PromoteError extends Error {
  constructor(
    public readonly code: 'RUN_NOT_FOUND' | 'CLUSTER_NOT_FOUND' | 'NO_MEMBERS',
    message: string,
  ) {
    super(message)
  }
}

export interface PromoteResult {
  segmentId: string
  name: string
  memberCount: number
}

/**
 * Promote one cluster from a discovery run into a static Segment. The Segment records its
 * provenance in `conditions` and is marked non-dynamic (a point-in-time snapshot — k-means
 * clusters are not stable across runs, so materialising the exact members is the honest
 * semantic). Membership is filtered to customers that still belong to the merchant and are
 * not merged away, preserving tenant safety.
 */
export async function promoteCluster(
  merchantId: string,
  runId: string,
  clusterIndex: number,
  overrides: { name?: string; description?: string },
): Promise<PromoteResult> {
  const run = await prisma.modelRun.findFirst({
    where: { id: runId, merchantId, modelName: 'segment-discovery' },
  })
  if (!run) throw new PromoteError('RUN_NOT_FOUND', 'Discovery run not found')

  const clusters = parseClusters(run.metadata)
  const cluster = clusters.find((c, i) => (c.index ?? i) === clusterIndex)
  if (!cluster) throw new PromoteError('CLUSTER_NOT_FOUND', 'Cluster not found in this run')

  const candidateIds = Array.isArray(cluster.customerIds) ? cluster.customerIds : []
  if (candidateIds.length === 0) throw new PromoteError('NO_MEMBERS', 'Cluster has no members')

  // Re-validate membership against live, tenant-owned, non-merged customers.
  const validCustomers = await prisma.customer.findMany({
    where: { merchantId, id: { in: candidateIds }, mergedIntoId: null },
    select: { id: true },
  })
  if (validCustomers.length === 0) throw new PromoteError('NO_MEMBERS', 'Cluster has no live members')

  const name = overrides.name?.trim() || cluster.label || `AI Cluster ${clusterIndex}`
  const description =
    overrides.description?.trim() ||
    cluster.description ||
    `Promoted from AI segment discovery (run ${runId}).`

  const conditions: Prisma.InputJsonValue = {
    _source: 'ai-cluster',
    modelRunId: runId,
    clusterIndex,
    label: cluster.label ?? null,
    recommendedAction: cluster.recommendedAction ?? null,
  }

  const now = new Date()
  const segment = await prisma.$transaction(async (tx) => {
    const seg = await tx.segment.create({
      data: {
        merchantId,
        name,
        description,
        conditions,
        isDynamic: false,
        memberCount: validCustomers.length,
        lastEvaluatedAt: now,
      },
    })
    await tx.segmentMembership.createMany({
      data: validCustomers.map((c) => ({ segmentId: seg.id, customerId: c.id, enteredAt: now })),
    })
    return seg
  })

  return { segmentId: segment.id, name: segment.name, memberCount: validCustomers.length }
}
