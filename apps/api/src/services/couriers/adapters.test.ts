import { describe, it, expect } from 'vitest'
import { postexAdapter } from './postex.adapter.js'
import { leopardsAdapter } from './leopards.adapter.js'
import { tcsAdapter } from './tcs.adapter.js'
import { mpAdapter } from './mp.adapter.js'

// The core "absent creds → clean no-op" contract: an adapter never hits the network
// (never throws) when its required credential fields are missing — it returns
// { configured: false } so the sync layer surfaces a clear status.
describe('courier adapters — no-op without credentials', () => {
  const emptyCtx = { credentials: {}, config: null }

  it('PostEx no-ops without a token', async () => {
    const r = await postexAdapter.fetchTracking('TRACK1', emptyCtx)
    expect(r).toEqual({ configured: false, reason: expect.stringContaining('token') })
  })

  it('Leopards no-ops without apiKey/apiPassword', async () => {
    const r = await leopardsAdapter.fetchTracking('TRACK1', emptyCtx)
    expect(r.configured).toBe(false)
  })

  it('TCS no-ops without clientId', async () => {
    const r = await tcsAdapter.fetchTracking('TRACK1', emptyCtx)
    expect(r.configured).toBe(false)
  })

  it('M&P no-ops without apiKey', async () => {
    const r = await mpAdapter.fetchTracking('TRACK1', emptyCtx)
    expect(r.configured).toBe(false)
  })

  it('each adapter reports its courier enum', () => {
    expect(postexAdapter.courier).toBe('POSTEX')
    expect(leopardsAdapter.courier).toBe('LEOPARDS')
    expect(tcsAdapter.courier).toBe('TCS')
    expect(mpAdapter.courier).toBe('MP')
  })
})
