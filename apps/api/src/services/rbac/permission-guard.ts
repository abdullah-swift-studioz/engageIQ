import type { FastifyRequest, FastifyReply } from 'fastify'
import { hasPermission, type Permission } from '@engageiq/shared'

/**
 * RBAC route guards (roadmap 8.3 / guide §9.4).
 *
 * These are `onRequest` hooks appended to a route group AFTER its existing
 * `fastify.authenticate` hook, so `request.user` (with the resolved role) is
 * already populated. They intentionally do NOT re-run authentication — that
 * avoids a double DB lookup and keeps the guard a pure authorization check.
 *
 * Deny → the standard error envelope: 403 FORBIDDEN (or 401 if, defensively,
 * no authenticated user is present).
 */

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface MethodPermissionMap {
  read: Permission
  write: Permission
}

/** HTTP verb → is this a mutating (write) request? */
export function isWriteMethod(method: string): boolean {
  return !READ_METHODS.has(method.toUpperCase())
}

/** Which permission a request needs, given its method and the group's read/write map. */
export function requiredPermissionForMethod(method: string, map: MethodPermissionMap): Permission {
  return isWriteMethod(method) ? map.write : map.read
}

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>

function deny401(reply: FastifyReply): void {
  reply.status(401).send({
    success: false,
    error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
  })
}

function deny403(reply: FastifyReply, permission: Permission): void {
  reply.status(403).send({
    success: false,
    error: {
      code: 'FORBIDDEN',
      message: `Your role does not have the required permission (${permission})`,
    },
  })
}

/**
 * Guard a route group where reads and writes need different permissions.
 * GET/HEAD/OPTIONS → `map.read`; everything else → `map.write`.
 */
export function requirePermissionByMethod(map: MethodPermissionMap): Guard {
  return async function permissionByMethodGuard(request, reply) {
    if (reply.sent) return
    const user = request.user
    if (!user || !user.role) {
      deny401(reply)
      return
    }
    const required = requiredPermissionForMethod(request.method, map)
    if (!hasPermission(user.role, required)) {
      deny403(reply, required)
    }
  }
}

/** Guard a route (or group) that requires one fixed permission regardless of method. */
export function requirePermission(permission: Permission): Guard {
  return async function permissionGuard(request, reply) {
    if (reply.sent) return
    const user = request.user
    if (!user || !user.role) {
      deny401(reply)
      return
    }
    if (!hasPermission(user.role, permission)) {
      deny403(reply, permission)
    }
  }
}
