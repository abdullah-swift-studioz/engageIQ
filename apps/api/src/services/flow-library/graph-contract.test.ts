import { describe, it, expect } from 'vitest'
import { validateGraph, GraphValidationError } from '../../routes/journeys/service.js'
import type { GraphNode } from '../../routes/journeys/schema.js'

/**
 * The Pre-Built Flow Library (lane:flows) instantiates a template by deep-copying its graph nodes
 * through the journey builder's `saveJourneyGraph`, which runs `validateGraph`. These tests lock
 * the contract every seeded FlowTemplate must satisfy: nodes emitted by the seeder's graph builder
 * form a single tree rooted at one TRIGGER, and CONDITION branch heads are labeled 'true'/'false'
 * (which is how the live executor routes them). A regression here would break "Use this flow".
 */

// A representative branching flow in exactly the shape flow-templates.seed.ts emits.
const BRANCHING_FLOW: GraphNode[] = [
  { tempId: 'n0', stepType: 'TRIGGER', label: 'Trigger', config: {}, positionX: 320, positionY: 40, parentTempId: null },
  { tempId: 'n1', stepType: 'DELAY', label: 'Wait 1 hour', config: { duration: 1, unit: 'hours' }, positionX: 320, positionY: 160, parentTempId: 'n0' },
  { tempId: 'n2', stepType: 'CONDITION', label: 'High-value cart?', config: { field: 'average_order_value', operator: 'gt', value: 5000 }, positionX: 320, positionY: 280, parentTempId: 'n1' },
  { tempId: 'n3', stepType: 'ACTION', label: 'true', config: { channel: 'WHATSAPP', content: { body: 'VIP path' } }, positionX: 580, positionY: 400, parentTempId: 'n2' },
  { tempId: 'n4', stepType: 'ACTION', label: 'false', config: { channel: 'WHATSAPP', content: { body: 'Standard path' } }, positionX: 60, positionY: 400, parentTempId: 'n2' },
]

const LINEAR_FLOW: GraphNode[] = [
  { tempId: 'a', stepType: 'TRIGGER', label: 'Trigger', config: {}, positionX: 320, positionY: 40, parentTempId: null },
  { tempId: 'b', stepType: 'ACTION', label: 'Email message', config: { channel: 'EMAIL', content: { subject: 'Hi', body: 'Welcome' } }, positionX: 320, positionY: 160, parentTempId: 'a' },
  { tempId: 'c', stepType: 'DELAY', label: 'Wait 2 days', config: { duration: 2, unit: 'days' }, positionX: 320, positionY: 280, parentTempId: 'b' },
  { tempId: 'd', stepType: 'ACTION', label: 'WhatsApp message', config: { channel: 'WHATSAPP', content: { body: 'Offer' } }, positionX: 320, positionY: 400, parentTempId: 'c' },
]

describe('flow library graph contract', () => {
  it('accepts a linear seeder-shaped flow graph', () => {
    expect(() => validateGraph(LINEAR_FLOW)).not.toThrow()
  })

  it('accepts a branching seeder-shaped flow graph', () => {
    expect(() => validateGraph(BRANCHING_FLOW)).not.toThrow()
  })

  it('labels CONDITION branch heads exactly "true" and "false" so the executor can route them', () => {
    const condition = BRANCHING_FLOW.find((n) => n.stepType === 'CONDITION')!
    const heads = BRANCHING_FLOW.filter((n) => n.parentTempId === condition.tempId).map((n) => n.label)
    expect(heads.slice().sort()).toEqual(['false', 'true'])
  })

  it('rejects a graph with two TRIGGER roots (guards against a malformed template)', () => {
    const twoTriggers: GraphNode[] = [
      ...LINEAR_FLOW,
      { tempId: 'z', stepType: 'TRIGGER', label: 'Trigger', config: {}, positionX: 0, positionY: 0, parentTempId: null },
    ]
    expect(() => validateGraph(twoTriggers)).toThrow(GraphValidationError)
  })
})
