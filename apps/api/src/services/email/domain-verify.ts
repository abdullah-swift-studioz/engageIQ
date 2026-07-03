// apps/api/src/services/email/domain-verify.ts
//
// SendingDomain DKIM/SPF/DMARC authentication flow (guide 7.3: "domain authentication set
// up automatically on merchant domain verification"). Two phases:
//   1. initiate → create the SendingDomain and return the exact DNS records to publish.
//   2. verify   → check the records are live, flip dkim/spf/dmarc booleans + overall status.
//
// External calls are mocked when AWS SES creds are absent so the whole flow is testable
// offline: without creds we generate deterministic DKIM tokens and (on verify) simulate
// a successful DNS/SES check. With creds present we do a real DNS lookup for each record.

import { createHash } from 'node:crypto'
import { resolveCname, resolveTxt } from 'node:dns/promises'
import { prisma } from '@engageiq/db'
import { Prisma } from '@prisma/client'
import { env } from '@engageiq/shared'

export interface DnsRecord {
  kind: 'DKIM' | 'SPF' | 'DMARC'
  type: 'CNAME' | 'TXT'
  name: string
  value: string
  // Human hint for the DNS panel.
  note?: string
}

function hasSesCreds(): boolean {
  return Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)
}

// Deterministic SES-style DKIM token (32 hex chars) for `domain` + selector index. In a
// real SES CreateEmailIdentity these come back from AWS; mocked here so the flow works
// offline and is stable across calls for the same domain.
function dkimToken(domain: string, index: number): string {
  return createHash('sha256').update(`${domain}:dkim:${index}`).digest('hex').slice(0, 32)
}

// The DNS records a merchant must publish. SES Easy DKIM uses three CNAMEs; SPF + DMARC
// are TXT records.
export function buildDnsRecords(domain: string): DnsRecord[] {
  const d = domain.toLowerCase().replace(/\.$/, '')
  const dkim: DnsRecord[] = [0, 1, 2].map((i) => {
    const token = dkimToken(d, i)
    return {
      kind: 'DKIM',
      type: 'CNAME',
      name: `${token}._domainkey.${d}`,
      value: `${token}.dkim.amazonses.com`,
      note: 'DKIM signing key (SES Easy DKIM)',
    }
  })
  return [
    ...dkim,
    {
      kind: 'SPF',
      type: 'TXT',
      name: d,
      value: 'v=spf1 include:amazonses.com ~all',
      note: 'Authorizes SES to send for your domain',
    },
    {
      kind: 'DMARC',
      type: 'TXT',
      name: `_dmarc.${d}`,
      value: 'v=DMARC1; p=none; rua=mailto:dmarc@' + d,
      note: 'DMARC policy (start with p=none, tighten later)',
    },
  ]
}

// Create (or return existing) SendingDomain with its DNS records, status PENDING.
export async function initiateSendingDomain(merchantId: string, domainInput: string) {
  const domain = domainInput.trim().toLowerCase().replace(/\.$/, '')
  const records = buildDnsRecords(domain)

  return prisma.sendingDomain.upsert({
    where: { merchantId_domain: { merchantId, domain } },
    update: { dnsRecords: records as unknown as Prisma.InputJsonValue },
    create: {
      merchantId,
      domain,
      status: 'PENDING',
      dnsRecords: records as unknown as Prisma.InputJsonValue,
    },
  })
}

export interface DnsChecker {
  cname(name: string): Promise<string[]>
  txt(name: string): Promise<string[]>
}

// Real DNS via node:dns; each lookup degrades to [] on NXDOMAIN/timeout so a missing
// record reads as "not verified" rather than throwing.
const liveDns: DnsChecker = {
  async cname(name) {
    try {
      return await resolveCname(name)
    } catch {
      return []
    }
  },
  async txt(name) {
    try {
      const records = await resolveTxt(name)
      return records.map((chunks) => chunks.join(''))
    } catch {
      return []
    }
  },
}

export async function checkRecordsLive(records: DnsRecord[], dns: DnsChecker): Promise<{
  dkim: boolean
  spf: boolean
  dmarc: boolean
}> {
  const dkimRecords = records.filter((r) => r.kind === 'DKIM')
  const dkimResults = await Promise.all(
    dkimRecords.map(async (r) => {
      const values = await dns.cname(r.name)
      return values.some((v) => v.replace(/\.$/, '') === r.value.replace(/\.$/, ''))
    }),
  )
  const dkim = dkimRecords.length > 0 && dkimResults.every(Boolean)

  const spfRecord = records.find((r) => r.kind === 'SPF')
  const spf = spfRecord ? (await dns.txt(spfRecord.name)).some((v) => v.includes('include:amazonses.com')) : false

  const dmarcRecord = records.find((r) => r.kind === 'DMARC')
  const dmarc = dmarcRecord ? (await dns.txt(dmarcRecord.name)).some((v) => v.includes('v=DMARC1')) : false

  return { dkim, spf, dmarc }
}

export interface VerifyResult {
  dkim: boolean
  spf: boolean
  dmarc: boolean
  status: string
  mocked: boolean
}

// Verify the domain's records. With SES creds → real DNS check; without creds → mock a
// successful check so the flow completes offline. `dns` is injectable for tests.
export async function verifySendingDomain(
  merchantId: string,
  id: string,
  dns: DnsChecker = liveDns,
): Promise<VerifyResult | null> {
  const domain = await prisma.sendingDomain.findFirst({ where: { id, merchantId } })
  if (!domain) return null

  const records = (domain.dnsRecords as unknown as DnsRecord[] | null) ?? buildDnsRecords(domain.domain)

  let checks: { dkim: boolean; spf: boolean; dmarc: boolean }
  let mocked = false
  if (hasSesCreds()) {
    checks = await checkRecordsLive(records, dns)
  } else {
    // No provider configured — mock a successful verification (offline flow).
    checks = { dkim: true, spf: true, dmarc: true }
    mocked = true
  }

  const allVerified = checks.dkim && checks.spf && checks.dmarc
  const status = allVerified ? 'VERIFIED' : 'PENDING'

  await prisma.sendingDomain.update({
    where: { id: domain.id },
    data: {
      dkimVerified: checks.dkim,
      spfVerified: checks.spf,
      dmarcVerified: checks.dmarc,
      status,
      ...(allVerified ? { verifiedAt: new Date() } : {}),
    },
  })

  return { ...checks, status, mocked }
}

export async function listSendingDomains(merchantId: string) {
  return prisma.sendingDomain.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' } })
}

export async function getSendingDomain(merchantId: string, id: string) {
  return prisma.sendingDomain.findFirst({ where: { id, merchantId } })
}

export async function deleteSendingDomain(merchantId: string, id: string): Promise<boolean> {
  const result = await prisma.sendingDomain.deleteMany({ where: { id, merchantId } })
  return result.count > 0
}
