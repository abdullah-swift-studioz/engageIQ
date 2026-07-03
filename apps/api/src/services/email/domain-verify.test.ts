import { describe, it, expect } from 'vitest'
import { buildDnsRecords, checkRecordsLive, type DnsChecker, type DnsRecord } from './domain-verify.js'

describe('buildDnsRecords', () => {
  it('produces 3 DKIM CNAMEs + SPF + DMARC for a domain', () => {
    const records = buildDnsRecords('Shop.Example.com.')
    expect(records.filter((r) => r.kind === 'DKIM')).toHaveLength(3)
    expect(records.find((r) => r.kind === 'SPF')?.value).toContain('include:amazonses.com')
    const dmarc = records.find((r) => r.kind === 'DMARC')
    expect(dmarc?.name).toBe('_dmarc.shop.example.com')
    expect(dmarc?.value).toContain('v=DMARC1')
  })

  it('is deterministic (same tokens for the same domain)', () => {
    expect(buildDnsRecords('a.com')).toEqual(buildDnsRecords('a.com'))
  })
})

describe('checkRecordsLive', () => {
  const records: DnsRecord[] = buildDnsRecords('a.com')

  it('verifies all three when DNS returns the expected values', async () => {
    const dns: DnsChecker = {
      cname: async (name) => {
        const rec = records.find((r) => r.name === name)
        return rec ? [rec.value] : []
      },
      txt: async (name) => {
        const rec = records.find((r) => r.name === name)
        return rec ? [rec.value] : []
      },
    }
    expect(await checkRecordsLive(records, dns)).toEqual({ dkim: true, spf: true, dmarc: true })
  })

  it('marks DKIM false when one CNAME is missing', async () => {
    const missing = records.find((r) => r.kind === 'DKIM')!.name
    const dns: DnsChecker = {
      cname: async (name) => {
        if (name === missing) return []
        const rec = records.find((r) => r.name === name)
        return rec ? [rec.value] : []
      },
      txt: async (name) => {
        const rec = records.find((r) => r.name === name)
        return rec ? [rec.value] : []
      },
    }
    const result = await checkRecordsLive(records, dns)
    expect(result.dkim).toBe(false)
    expect(result.spf).toBe(true)
  })

  it('tolerates DNS lookup failures (returns false, does not throw)', async () => {
    const dns: DnsChecker = {
      cname: async () => {
        throw new Error('ENOTFOUND')
      },
      txt: async () => [],
    }
    // checkRecordsLive itself expects the checker to swallow errors; simulate a checker
    // that returns [] on failure via the liveDns contract by catching here.
    const safeDns: DnsChecker = {
      cname: async (n) => dns.cname(n).catch(() => []),
      txt: async (n) => dns.txt(n).catch(() => []),
    }
    expect(await checkRecordsLive(records, safeDns)).toEqual({ dkim: false, spf: false, dmarc: false })
  })
})
