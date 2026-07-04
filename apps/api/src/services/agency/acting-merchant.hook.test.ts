import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./access.service.js', async () => {
  const actual = await vi.importActual<typeof import('./access.service.js')>('./access.service.js')
  return {
    ...actual,
    resolveActingMerchant: vi.fn(),
  }
})

import { actingMerchantPreHandler } from './acting-merchant.hook.js'
import { resolveActingMerchant, AgencyAccessError } from './access.service.js'
import type { FastifyRequest, FastifyReply } from 'fastify'

const mockResolve = resolveActingMerchant as unknown as ReturnType<typeof vi.fn>

function makeReply() {
  const reply = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code
      return this
    },
    send: vi.fn(),
  }
  return reply as unknown as FastifyReply & { statusCode: number; send: ReturnType<typeof vi.fn> }
}

function makeRequest(
  user: { userId: string; merchantId: string; role: string } | undefined,
  header?: string,
) {
  return {
    headers: header ? { 'x-acting-merchant-id': header } : {},
    user,
  } as unknown as FastifyRequest
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('actingMerchantPreHandler', () => {
  it('no-ops for unauthenticated requests', async () => {
    const req = makeRequest(undefined, 'child_a')
    const reply = makeReply()
    await actingMerchantPreHandler(req, reply)
    expect(reply.send).not.toHaveBeenCalled()
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('sets home/acting baseline and does not switch when no header', async () => {
    const req = makeRequest({ userId: 'u', merchantId: 'home', role: 'AGENCY_ADMIN' })
    await actingMerchantPreHandler(req, makeReply())
    expect(req.homeMerchantId).toBe('home')
    expect(req.actingMerchantId).toBe('home')
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('ignores the header for a NON-agency role (cannot switch)', async () => {
    const req = makeRequest({ userId: 'u', merchantId: 'home', role: 'OWNER' }, 'child_a')
    await actingMerchantPreHandler(req, makeReply())
    expect(req.user.merchantId).toBe('home')
    expect(req.actingMerchantId).toBe('home')
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('swaps the effective merchant for an agency user with a valid child', async () => {
    mockResolve.mockResolvedValue('child_a')
    const req = makeRequest({ userId: 'u', merchantId: 'home', role: 'AGENCY_ADMIN' }, 'child_a')
    await actingMerchantPreHandler(req, makeReply())
    expect(req.user.merchantId).toBe('child_a')
    expect(req.actingMerchantId).toBe('child_a')
    expect(req.homeMerchantId).toBe('home')
  })

  it('returns 403 when access is denied', async () => {
    mockResolve.mockRejectedValue(new AgencyAccessError())
    const req = makeRequest({ userId: 'u', merchantId: 'home', role: 'AGENCY_MEMBER' }, 'child_x')
    const reply = makeReply()
    await actingMerchantPreHandler(req, reply)
    expect(reply.statusCode).toBe(403)
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'AGENCY_ACCESS_DENIED' }) }),
    )
    // merchant not switched
    expect(req.user.merchantId).toBe('home')
  })
})
