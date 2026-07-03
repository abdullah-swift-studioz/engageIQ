import { describe, it, expect } from 'vitest'
import { PUBLIC_API_SCOPES, isValidScope } from './scopes.js'

describe('public API scopes', () => {
  it('lists the expected scopes', () => {
    expect(PUBLIC_API_SCOPES).toContain('customers:read')
    expect(PUBLIC_API_SCOPES).toContain('segments:write')
    expect(PUBLIC_API_SCOPES).toContain('campaigns:trigger')
    expect(PUBLIC_API_SCOPES).toContain('analytics:read')
  })

  it('validates scope strings', () => {
    expect(isValidScope('events:write')).toBe(true)
    expect(isValidScope('billing:manage')).toBe(false) // dashboard permission, not a public scope
    expect(isValidScope('garbage')).toBe(false)
  })
})
