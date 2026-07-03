import { describe, it, expect, vi } from 'vitest'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Role } from '@engageiq/shared'
import {
  isWriteMethod,
  requiredPermissionForMethod,
  requirePermission,
  requirePermissionByMethod,
} from './permission-guard.js'

describe('isWriteMethod', () => {
  it('treats read verbs as reads', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(isWriteMethod(m)).toBe(false)
    }
  })
  it('treats mutating verbs as writes', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'delete']) {
      expect(isWriteMethod(m)).toBe(true)
    }
  })
})

describe('requiredPermissionForMethod', () => {
  const map = { read: 'campaigns:read', write: 'campaigns:write' } as const
  it('picks read permission for GET', () => {
    expect(requiredPermissionForMethod('GET', map)).toBe('campaigns:read')
  })
  it('picks write permission for POST', () => {
    expect(requiredPermissionForMethod('POST', map)).toBe('campaigns:write')
  })
})

// Minimal request/reply doubles for hook-level assertions.
function makeReply() {
  const reply = {
    sent: false,
    statusCode: 200,
    status(code: number) {
      this.statusCode = code
      return this
    },
    send: vi.fn(function (this: { sent: boolean }) {
      this.sent = true
      return this
    }),
  }
  return reply as unknown as FastifyReply & {
    statusCode: number
    send: ReturnType<typeof vi.fn>
  }
}

function makeRequest(role: Role | undefined, method: string) {
  return {
    method,
    user: role ? { userId: 'u1', merchantId: 'm1', role } : undefined,
  } as unknown as FastifyRequest
}

describe('requirePermissionByMethod hook', () => {
  const guard = requirePermissionByMethod({ read: 'campaigns:read', write: 'campaigns:write' })

  it('allows an Analyst to GET (has campaigns:read)', async () => {
    const reply = makeReply()
    await guard(makeRequest('ANALYST', 'GET'), reply)
    expect(reply.send).not.toHaveBeenCalled()
  })

  it('blocks an Analyst from POST (lacks campaigns:write) with 403', async () => {
    const reply = makeReply()
    await guard(makeRequest('ANALYST', 'POST'), reply)
    expect(reply.statusCode).toBe(403)
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'FORBIDDEN' }) }),
    )
  })

  it('allows a Marketer to POST (has campaigns:write)', async () => {
    const reply = makeReply()
    await guard(makeRequest('MARKETER', 'POST'), reply)
    expect(reply.send).not.toHaveBeenCalled()
  })

  it('rejects with 401 when no authenticated user is present', async () => {
    const reply = makeReply()
    await guard(makeRequest(undefined, 'GET'), reply)
    expect(reply.statusCode).toBe(401)
    expect(reply.send).toHaveBeenCalled()
  })

  it('does nothing if the reply was already sent (e.g. auth failed upstream)', async () => {
    const reply = makeReply()
    reply.sent = true
    await guard(makeRequest(undefined, 'GET'), reply)
    expect(reply.send).not.toHaveBeenCalled()
  })
})

describe('requirePermission (single) hook', () => {
  const guard = requirePermission('users:manage')

  it('allows OWNER', async () => {
    const reply = makeReply()
    await guard(makeRequest('OWNER', 'POST'), reply)
    expect(reply.send).not.toHaveBeenCalled()
  })

  it('blocks MARKETER (no users:manage) even on a GET', async () => {
    const reply = makeReply()
    await guard(makeRequest('MARKETER', 'GET'), reply)
    expect(reply.statusCode).toBe(403)
  })

  it('allows AGENCY_ADMIN for agency:manage', async () => {
    const reply = makeReply()
    await requirePermission('agency:manage')(makeRequest('AGENCY_ADMIN', 'GET'), reply)
    expect(reply.send).not.toHaveBeenCalled()
  })

  it('blocks AGENCY_MEMBER for agency:manage', async () => {
    const reply = makeReply()
    await requirePermission('agency:manage')(makeRequest('AGENCY_MEMBER', 'GET'), reply)
    expect(reply.statusCode).toBe(403)
  })

  it('blocks ADMIN for billing:manage (owner-only)', async () => {
    const reply = makeReply()
    await requirePermission('billing:manage')(makeRequest('ADMIN', 'GET'), reply)
    expect(reply.statusCode).toBe(403)
  })
})
