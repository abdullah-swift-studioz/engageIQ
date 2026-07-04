import { describe, it, expect, vi } from 'vitest'

// buildReturnItems is pure, but importing refund.processor pulls in the db/shared/queue
// packages transitively (order.processor → services → env). Mock them so the import does
// not run real env validation (which process.exit(1)s) or open a Redis/Prisma connection.
vi.mock('@engageiq/shared', () => ({ env: {} }))
vi.mock('@engageiq/db', () => ({ prisma: {} }))
vi.mock('@engageiq/queue', () => ({ redisConnection: {}, journeyExecutorQueue: { add: vi.fn() } }))

import { buildReturnItems } from './refund.processor.js'

const orderLineItems = [
  { line_item_id: '111', product_id: '900', title: 'Kurta', quantity: 2, price: '1500', sku: 'K1' },
  { line_item_id: '222', product_id: '901', title: 'Shawl', quantity: 1, price: '3000', sku: 'S1' },
]

describe('buildReturnItems', () => {
  it('resolves product_id from the order line items by line_item_id', () => {
    const items = buildReturnItems(orderLineItems, [
      { line_item_id: 111, quantity: 1, subtotal: '1500' },
    ])
    expect(items).toEqual([
      { product_id: '900', line_item_id: '111', quantity: 1, subtotal: 1500 },
    ])
  })

  it('maps multiple refund lines and coerces subtotal to a number', () => {
    const items = buildReturnItems(orderLineItems, [
      { line_item_id: 111, quantity: 2, subtotal: '3000' },
      { line_item_id: 222, quantity: 1, subtotal: '3000.50' },
    ])
    expect(items).toHaveLength(2)
    expect(items[1]).toEqual({
      product_id: '901',
      line_item_id: '222',
      quantity: 1,
      subtotal: 3000.5,
    })
  })

  it('keeps the return with product_id=null when the line_item_id is not in the order', () => {
    const items = buildReturnItems(orderLineItems, [
      { line_item_id: 999, quantity: 1, subtotal: '500' },
    ])
    expect(items).toEqual([
      { product_id: null, line_item_id: '999', quantity: 1, subtotal: 500 },
    ])
  })

  it('drops zero/negative-quantity refund lines', () => {
    const items = buildReturnItems(orderLineItems, [
      { line_item_id: 111, quantity: 0, subtotal: '0' },
      { line_item_id: 222, quantity: -1, subtotal: '0' },
    ])
    expect(items).toEqual([])
  })

  it('returns an empty array when the order has no stored line items', () => {
    const items = buildReturnItems(null, [{ line_item_id: 111, quantity: 1, subtotal: '1500' }])
    expect(items).toEqual([{ product_id: null, line_item_id: '111', quantity: 1, subtotal: 1500 }])
  })
})
