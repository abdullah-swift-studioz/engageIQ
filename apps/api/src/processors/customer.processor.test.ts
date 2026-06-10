import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../services/journey-entry.service.js', () => ({
  checkJourneyEntry: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@engageiq/db', () => ({
  prisma: {
    customer: {
      findFirst: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
  },
}))

import type { ShopifyCustomerPayload } from '@engageiq/shared'
import { prisma } from '@engageiq/db'
import { processCustomerUpsert } from './customer.processor.js'

const MERCHANT_ID = 'merchant-1'

const basePayload: ShopifyCustomerPayload = {
  id: 99999,
  email: 'test@example.com',
  phone: '03001234567',
  first_name: 'Test',
  last_name: 'User',
  default_address: { city: 'Karachi', province: 'Sindh', country_code: 'PK' },
  tags: '',
  accepts_marketing: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

describe('processCustomerUpsert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upgrades a stub in place when a matching email stub exists', async () => {
    const stubId = 'stub-customer-1'
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({ id: stubId } as never)
    vi.mocked(prisma.customer.update).mockResolvedValue({ id: stubId } as never)

    const result = await processCustomerUpsert(MERCHANT_ID, basePayload)

    expect(result).toBe(stubId)
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: stubId },
      data: expect.objectContaining({
        shopifyCustomerId: '99999',
        email: 'test@example.com',
      }),
    })
    // Must NOT call upsert when stub found
    expect(prisma.customer.upsert).not.toHaveBeenCalled()
  })

  it('falls through to upsert when no stub exists', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.customer.upsert).mockResolvedValue({ id: 'new-customer-1' } as never)

    const result = await processCustomerUpsert(MERCHANT_ID, basePayload)

    expect(result).toBe('new-customer-1')
    expect(prisma.customer.upsert).toHaveBeenCalled()
  })

  it('falls through to upsert when payload has no email', async () => {
    const noEmailPayload = { ...basePayload, email: null }
    vi.mocked(prisma.customer.upsert).mockResolvedValue({ id: 'new-customer-2' } as never)

    await processCustomerUpsert(MERCHANT_ID, noEmailPayload)

    // findFirst should not be called at all when there is no email
    expect(prisma.customer.findFirst).not.toHaveBeenCalled()
    expect(prisma.customer.upsert).toHaveBeenCalled()
  })
})
