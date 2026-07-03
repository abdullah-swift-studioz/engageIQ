/**
 * Scopes a merchant can grant to a public API key. Each public route requires one.
 * Stored on ApiKey.scopes (String[]). These strings are a stable public contract.
 */
export const PUBLIC_API_SCOPES = [
  'customers:read',
  'segments:read',
  'segments:write',
  'events:write',
  'campaigns:read',
  'campaigns:trigger',
  'analytics:read',
] as const

export type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number]

export function isValidScope(scope: string): scope is PublicApiScope {
  return (PUBLIC_API_SCOPES as readonly string[]).includes(scope)
}
