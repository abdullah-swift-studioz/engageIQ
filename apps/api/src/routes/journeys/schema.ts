import { z } from 'zod'

// AB_SPLIT is accepted for persistence by the visual builder (canonical 6.1). The journey
// execution engine does not yet route AB_SPLIT branches (it has no executor case), so a saved
// AB_SPLIT node currently terminates an enrollment when reached — wiring its execution is a
// handoff to the journey-execution-engine work. See updates/2026-06-28_phase6_journey-builder.md.
export const StepTypeEnum = z.enum(['TRIGGER', 'ACTION', 'CONDITION', 'DELAY', 'AB_SPLIT'])

export const CreateStepSchema = z.object({
  stepType: StepTypeEnum,
  parentStepId: z.string().cuid().nullable().default(null),
  label: z.string().max(100).nullable().default(null),
  config: z.unknown(),
  positionX: z.number().int().default(0),
  positionY: z.number().int().default(0),
})

// ─── Visual Journey Builder graph save (lane:journey) ─────────────────────────
//
// The builder posts the whole canvas as a flat node list. Each node carries a client-side
// `tempId` and a `parentTempId` referencing its single parent node (the React Flow edge source).
// The server resolves temp ids to real cuids and wires `parentStepId`, so the graph round-trips
// into the existing self-referential journey_steps shape. Branch routing (CONDITION true/false,
// AB_SPLIT variants) is carried in each child node's `label`, matching the executor contract.
export const GraphNodeSchema = z.object({
  tempId: z.string().min(1).max(64),
  stepType: StepTypeEnum,
  label: z.string().max(100).nullable().default(null),
  config: z.unknown().default({}),
  positionX: z.number().int().default(0),
  positionY: z.number().int().default(0),
  parentTempId: z.string().min(1).max(64).nullable().default(null),
})

export const SaveGraphBodySchema = z.object({
  nodes: z.array(GraphNodeSchema).max(200),
})

export const CreateJourneyBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  triggerType: z.enum(['segment_entered', 'order_placed', 'custom_event', 'scheduled']),
  triggerConfig: z.unknown().default({}),
  reEntryRule: z.enum(['ALLOW', 'DISALLOW', 'RE_ENROLL_AFTER_EXIT']).default('DISALLOW'),
  exitTrigger: z.enum(['order_placed', 'segment_entered', 'custom_event']).nullable().optional(),
  steps: z.array(CreateStepSchema).default([]),
})

export const UpdateJourneyBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  triggerType: z.enum(['segment_entered', 'order_placed', 'custom_event', 'scheduled']).optional(),
  triggerConfig: z.unknown().optional(),
  reEntryRule: z.enum(['ALLOW', 'DISALLOW', 'RE_ENROLL_AFTER_EXIT']).optional(),
  exitTrigger: z.enum(['order_placed', 'segment_entered', 'custom_event']).nullable().optional(),
  steps: z.array(CreateStepSchema).optional(),
})

export const JourneyParamsSchema = z.object({
  id: z.string().cuid(),
})

export const ListJourneysQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

export const ListEnrollmentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['ACTIVE', 'COMPLETED', 'EXITED', 'FAILED']).optional(),
})

export type CreateJourneyBody = z.infer<typeof CreateJourneyBodySchema>
export type UpdateJourneyBody = z.infer<typeof UpdateJourneyBodySchema>
export type GraphNode = z.infer<typeof GraphNodeSchema>
export type SaveGraphBody = z.infer<typeof SaveGraphBodySchema>
export type JourneyParams = z.infer<typeof JourneyParamsSchema>
export type ListJourneysQuery = z.infer<typeof ListJourneysQuerySchema>
export type ListEnrollmentsQuery = z.infer<typeof ListEnrollmentsQuerySchema>
