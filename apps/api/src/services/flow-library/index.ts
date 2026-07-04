import { prisma } from '@engageiq/db'
import type {
  FlowTemplateDTO,
  FlowCategory,
  FlowTemplateGraph,
  ChannelName,
  FlowInstantiationResult,
} from '@engageiq/shared'
// Reuse the visual builder's graph-save path so an instantiated flow round-trips into the same
// journey_steps shape the live executor already runs. We do NOT rebuild the executor.
import { saveJourneyGraph } from '../../routes/journeys/service.js'
import type { GraphNode } from '../../routes/journeys/schema.js'

type FlowTemplateRow = {
  key: string
  name: string
  category: string
  description: string
  channels: ChannelName[]
  icon: string | null
  graphJson: unknown
}

function toDTO(row: FlowTemplateRow): FlowTemplateDTO {
  return {
    key: row.key,
    name: row.name,
    category: row.category as FlowCategory,
    description: row.description,
    channels: row.channels,
    icon: row.icon,
    graph: row.graphJson as FlowTemplateGraph,
  }
}

/** Thrown when a requested template key does not exist (or is retired) → HTTP 404. */
export class FlowTemplateNotFoundError extends Error {
  override name = 'FlowTemplateNotFoundError'
}

/**
 * List all active system flow templates, ordered for stable catalog display. System table —
 * not merchant-scoped, so no tenant filter (these rows carry no merchant data).
 */
export async function listFlowTemplates(): Promise<FlowTemplateDTO[]> {
  const rows = await prisma.flowTemplate.findMany({
    where: { isActive: true, isSystem: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      key: true,
      name: true,
      category: true,
      description: true,
      channels: true,
      icon: true,
      graphJson: true,
    },
  })
  return rows.map(toDTO)
}

/** Fetch one active template (including its full graph) for preview. */
export async function getFlowTemplate(key: string): Promise<FlowTemplateDTO | null> {
  const row = await prisma.flowTemplate.findFirst({
    where: { key, isActive: true },
    select: {
      key: true,
      name: true,
      category: true,
      description: true,
      channels: true,
      icon: true,
      graphJson: true,
    },
  })
  return row ? toDTO(row) : null
}

/**
 * "Use this flow": deep-copy a system template into a real, editable merchant Journey.
 *
 * Creates a DRAFT Journey from the template's trigger definition (stamping
 * `sourceFlowTemplateKey` for provenance), then writes the graph into journey_steps by reusing
 * the builder's `saveJourneyGraph`. The merchant then edits it in the existing visual builder and
 * activates it — the live executor runs it unchanged. Tenant-safe: the journey is created under
 * `merchantId`, and `saveJourneyGraph` re-verifies ownership before writing steps.
 */
export async function instantiateFlowTemplate(
  merchantId: string,
  key: string,
): Promise<FlowInstantiationResult> {
  const template = await prisma.flowTemplate.findFirst({
    where: { key, isActive: true },
    select: { key: true, name: true, description: true, graphJson: true },
  })
  if (!template) throw new FlowTemplateNotFoundError(`Flow template not found: ${key}`)

  const graph = template.graphJson as unknown as FlowTemplateGraph

  const journey = await prisma.journey.create({
    data: {
      merchantId,
      name: template.name,
      description: template.description,
      triggerType: graph.trigger.triggerType,
      triggerConfig: graph.trigger.triggerConfig as object,
      reEntryRule: graph.trigger.reEntryRule,
      exitTrigger: graph.trigger.exitTrigger,
      status: 'DRAFT',
      sourceFlowTemplateKey: template.key,
    },
    select: { id: true, name: true },
  })

  const nodes = graph.nodes as unknown as GraphNode[]
  const saved = await saveJourneyGraph(merchantId, journey.id, nodes)

  return {
    journeyId: journey.id,
    name: journey.name,
    sourceFlowTemplateKey: template.key,
    stepCount: saved?.steps.length ?? 0,
  }
}
