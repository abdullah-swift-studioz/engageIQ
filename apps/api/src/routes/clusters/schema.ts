import { z } from 'zod'

// POST /api/v1/clusters/:runId/promote — promote one discovered cluster into a Segment.
export const PromoteClusterParamsSchema = z.object({
  runId: z.string().min(1),
})

export const PromoteClusterBodySchema = z.object({
  // Which cluster in the run to promote (stable index recorded in ModelRun.metadata).
  clusterIndex: z.number().int().min(0),
  // Optional overrides; default to the cluster's own label / description.
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
})

export type PromoteClusterBody = z.infer<typeof PromoteClusterBodySchema>
