import type { Role } from './types.js'

export type Permission =
  | 'campaigns:read'
  | 'campaigns:write'
  | 'segments:read'
  | 'segments:write'
  | 'analytics:read'
  | 'journeys:read'
  | 'journeys:write'
  | 'customers:read'
  | 'api_keys:manage'
  | 'billing:manage'
  | 'users:manage'
  | 'agency:manage'

const ALL_PERMISSIONS: Set<Permission> = new Set([
  'campaigns:read',
  'campaigns:write',
  'segments:read',
  'segments:write',
  'analytics:read',
  'journeys:read',
  'journeys:write',
  'customers:read',
  'api_keys:manage',
  'billing:manage',
  'users:manage',
  'agency:manage',
])

const ALL_EXCEPT_BILLING: Set<Permission> = new Set([
  'campaigns:read',
  'campaigns:write',
  'segments:read',
  'segments:write',
  'analytics:read',
  'journeys:read',
  'journeys:write',
  'customers:read',
  'api_keys:manage',
  'users:manage',
])

const MARKETER_PERMISSIONS: Set<Permission> = new Set([
  'campaigns:read',
  'campaigns:write',
  'segments:read',
  'segments:write',
  'journeys:read',
  'journeys:write',
  'customers:read',
  'analytics:read',
])

const ANALYST_PERMISSIONS: Set<Permission> = new Set([
  'analytics:read',
  'segments:read',
  'customers:read',
  'campaigns:read',
  'journeys:read',
])

export const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  OWNER: ALL_PERMISSIONS,
  ADMIN: ALL_EXCEPT_BILLING,
  MARKETER: MARKETER_PERMISSIONS,
  ANALYST: ANALYST_PERMISSIONS,
  AGENCY_ADMIN: new Set([...ALL_EXCEPT_BILLING, 'agency:manage']),
  AGENCY_MEMBER: MARKETER_PERMISSIONS,
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission)
}

export function isAgencyRole(role: Role): boolean {
  return role === 'AGENCY_ADMIN' || role === 'AGENCY_MEMBER'
}

