// Pure transforms between the API's flat journey_steps shape and the React Flow node/edge model.
// No React, no side effects — kept isolated so the mapping logic is easy to reason about.

import type { Edge, Node } from '@xyflow/react'
import type {
  ApiJourneyStep,
  GraphSaveNode,
  JourneyNodeData,
  StepType,
} from './types'

export type JourneyNode = Node<JourneyNodeData>

let idCounter = 0
/** Generates a unique client-side node id for nodes added on the canvas. */
export function newNodeId(): string {
  idCounter += 1
  return `n_${idCounter}_${Math.floor(performance.now())}`
}

const BRANCHING: StepType[] = ['CONDITION', 'AB_SPLIT']

/** Default config for a freshly-dropped node of each type. */
export function defaultConfig(stepType: StepType): JourneyNodeData['config'] {
  switch (stepType) {
    case 'TRIGGER':
      return { triggerType: 'segment_entered' }
    case 'ACTION':
      return { channel: 'WHATSAPP', content: { body: '' } }
    case 'CONDITION':
      return { field: 'total_orders', operator: 'gte', value: 1 }
    case 'DELAY':
      return { duration: 1, unit: 'days' }
    case 'AB_SPLIT':
      return {
        variants: [
          { key: 'A', label: 'Variant A', weight: 50 },
          { key: 'B', label: 'Variant B', weight: 50 },
        ],
      }
    default:
      return {}
  }
}

/** API steps → React Flow nodes + edges. Branch routing is recovered from each child's label. */
export function stepsToFlow(steps: ApiJourneyStep[]): { nodes: JourneyNode[]; edges: Edge[] } {
  const byId = new Map(steps.map((s) => [s.id, s]))

  const nodes: JourneyNode[] = steps.map((s) => ({
    id: s.id,
    type: 'journeyNode',
    position: { x: s.positionX, y: s.positionY },
    data: {
      stepType: s.stepType,
      config: (s.config ?? {}) as JourneyNodeData['config'],
      branchLabel: s.label,
    },
  }))

  const edges: Edge[] = []
  for (const s of steps) {
    if (!s.parentStepId) continue
    const parent = byId.get(s.parentStepId)
    if (!parent) continue
    const isBranch = BRANCHING.includes(parent.stepType)
    edges.push({
      id: `e_${s.parentStepId}_${s.id}`,
      source: s.parentStepId,
      target: s.id,
      // Branch parents anchor each edge to a named source handle so the true/false (or variant)
      // routing survives a round-trip; linear parents use their single default handle.
      ...(isBranch && s.label ? { sourceHandle: s.label } : {}),
      label: isBranch ? s.label ?? undefined : undefined,
    })
  }

  return { nodes, edges }
}

/** React Flow nodes + edges → the PUT /:id/graph payload. */
export function flowToSaveNodes(nodes: JourneyNode[], edges: Edge[]): GraphSaveNode[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  // Each node has at most one incoming edge (enforced at connect time + validated server-side).
  const incoming = new Map<string, Edge>()
  for (const e of edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, e)
  }

  return nodes.map((n) => {
    const inEdge = incoming.get(n.id)
    const parent = inEdge ? nodeById.get(inEdge.source) : undefined
    const parentIsBranch = parent ? BRANCHING.includes(parent.data.stepType) : false
    // For branch children the label IS the routing key (the source handle); linear children carry
    // no routing label.
    const label = parentIsBranch ? (inEdge?.sourceHandle ?? null) : null

    return {
      tempId: n.id,
      stepType: n.data.stepType,
      label,
      config: n.data.config ?? {},
      positionX: Math.round(n.position.x),
      positionY: Math.round(n.position.y),
      parentTempId: inEdge ? inEdge.source : null,
    }
  })
}

/**
 * Client-side mirror of the server's structural rules, surfaced live in the builder so the user
 * sees problems before saving. The server (validateGraph) remains authoritative.
 */
export function validateFlow(nodes: JourneyNode[], edges: Edge[]): string[] {
  const problems: string[] = []
  if (nodes.length === 0) return problems

  const triggers = nodes.filter((n) => n.data.stepType === 'TRIGGER')
  if (triggers.length === 0) problems.push('Add a Trigger node — every journey needs one entry point.')
  if (triggers.length > 1) problems.push('Only one Trigger node is allowed.')

  const incomingCount = new Map<string, number>()
  for (const e of edges) incomingCount.set(e.target, (incomingCount.get(e.target) ?? 0) + 1)

  for (const n of nodes) {
    const inCount = incomingCount.get(n.id) ?? 0
    if (n.data.stepType === 'TRIGGER') {
      if (inCount > 0) problems.push('The Trigger node must be the start — it cannot have an incoming connection.')
    } else if (inCount === 0) {
      problems.push(`A ${n.data.stepType} node is not connected to the journey.`)
    } else if (inCount > 1) {
      problems.push(`A ${n.data.stepType} node has more than one incoming connection.`)
    }
  }

  // CONDITION branch hygiene (warning-level; server stays permissive for drafts).
  for (const n of nodes) {
    if (n.data.stepType !== 'CONDITION') continue
    const out = edges.filter((e) => e.source === n.id)
    const handles = out.map((e) => e.sourceHandle)
    if (out.length > 2) problems.push('A Condition node can have at most two branches (true / false).')
    if (handles.filter((h) => h === 'true').length > 1) problems.push('A Condition has two "true" branches.')
    if (handles.filter((h) => h === 'false').length > 1) problems.push('A Condition has two "false" branches.')
  }

  return problems
}
