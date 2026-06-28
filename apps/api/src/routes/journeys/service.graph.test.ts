import { describe, it, expect, vi } from 'vitest'

// validateGraph is pure, but importing ./service.js pulls in @engageiq/db (and its env
// validation, which process.exit(1)s without a loaded .env). Stub it — the graph validator
// never touches prisma. Mirrors the mocking convention in the executor worker test.
vi.mock('@engageiq/db', () => ({ prisma: {} }))

import { validateGraph, GraphValidationError } from './service.js'
import type { GraphNode } from './schema.js'

// Minimal GraphNode factory — only the fields validateGraph reads matter here.
function node(partial: Partial<GraphNode> & Pick<GraphNode, 'tempId' | 'stepType'>): GraphNode {
  return {
    label: null,
    config: {},
    positionX: 0,
    positionY: 0,
    parentTempId: null,
    ...partial,
  }
}

describe('validateGraph', () => {
  it('accepts an empty graph (clearing a draft canvas)', () => {
    expect(() => validateGraph([])).not.toThrow()
  })

  it('accepts a single TRIGGER root', () => {
    expect(() => validateGraph([node({ tempId: 't', stepType: 'TRIGGER' })])).not.toThrow()
  })

  it('accepts a linear trigger → action → delay chain', () => {
    const nodes = [
      node({ tempId: 't', stepType: 'TRIGGER' }),
      node({ tempId: 'a', stepType: 'ACTION', parentTempId: 't' }),
      node({ tempId: 'd', stepType: 'DELAY', parentTempId: 'a' }),
    ]
    expect(() => validateGraph(nodes)).not.toThrow()
  })

  it('accepts a CONDITION with two labelled branch children', () => {
    const nodes = [
      node({ tempId: 't', stepType: 'TRIGGER' }),
      node({ tempId: 'c', stepType: 'CONDITION', parentTempId: 't' }),
      node({ tempId: 'y', stepType: 'ACTION', parentTempId: 'c', label: 'true' }),
      node({ tempId: 'n', stepType: 'ACTION', parentTempId: 'c', label: 'false' }),
    ]
    expect(() => validateGraph(nodes)).not.toThrow()
  })

  it('rejects a graph with no TRIGGER', () => {
    expect(() => validateGraph([node({ tempId: 'a', stepType: 'ACTION' })])).toThrow(
      GraphValidationError,
    )
  })

  it('rejects more than one TRIGGER', () => {
    const nodes = [
      node({ tempId: 't1', stepType: 'TRIGGER' }),
      node({ tempId: 't2', stepType: 'TRIGGER' }),
    ]
    expect(() => validateGraph(nodes)).toThrow(/only one TRIGGER/)
  })

  it('rejects a TRIGGER that has a parent', () => {
    const nodes = [
      node({ tempId: 'a', stepType: 'ACTION' }),
      node({ tempId: 't', stepType: 'TRIGGER', parentTempId: 'a' }),
    ]
    expect(() => validateGraph(nodes)).toThrow(GraphValidationError)
  })

  it('rejects a disconnected (orphan) node', () => {
    const nodes = [
      node({ tempId: 't', stepType: 'TRIGGER' }),
      node({ tempId: 'orphan', stepType: 'ACTION', parentTempId: null }),
    ]
    expect(() => validateGraph(nodes)).toThrow(/not connected/)
  })

  it('rejects a parent reference that does not exist', () => {
    const nodes = [
      node({ tempId: 't', stepType: 'TRIGGER' }),
      node({ tempId: 'a', stepType: 'ACTION', parentTempId: 'ghost' }),
    ]
    expect(() => validateGraph(nodes)).toThrow(/missing parent/)
  })

  it('rejects duplicate temp ids', () => {
    const nodes = [
      node({ tempId: 't', stepType: 'TRIGGER' }),
      node({ tempId: 't', stepType: 'ACTION', parentTempId: 't' }),
    ]
    expect(() => validateGraph(nodes)).toThrow(/Duplicate/)
  })

  it('rejects a self-referencing node', () => {
    const nodes = [
      node({ tempId: 't', stepType: 'TRIGGER' }),
      node({ tempId: 'a', stepType: 'ACTION', parentTempId: 'a' }),
    ]
    expect(() => validateGraph(nodes)).toThrow(/itself/)
  })

  it('rejects a cycle among non-root nodes', () => {
    // t → a → b → a (b points back to a)
    const nodes = [
      node({ tempId: 't', stepType: 'TRIGGER' }),
      node({ tempId: 'a', stepType: 'ACTION', parentTempId: 'b' }),
      node({ tempId: 'b', stepType: 'ACTION', parentTempId: 'a' }),
    ]
    // No node here is parentless except the trigger, but a/b form a cycle disconnected from t.
    expect(() => validateGraph(nodes)).toThrow(GraphValidationError)
  })
})
