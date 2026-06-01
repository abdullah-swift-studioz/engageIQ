import { prisma, insertEvents } from '@engageiq/db'
import type { EngageIQEvent } from '@engageiq/db'
import type { CustomEventBody } from './schema.js'

export async function ingestCustomEvent(
  merchantId: string,
  body: Pick<CustomEventBody, 'event_name' | 'customer_id' | 'anon_id' | 'properties' | 'timestamp'>,
): Promise<{ event_id: string }> {
  if (body.customer_id) {
    const customer = await prisma.customer.findFirst({
      where: { id: body.customer_id, merchantId },
      select: { id: true },
    })
    if (!customer) throw new Error('CUSTOMER_NOT_FOUND')
  }

  const event_id = crypto.randomUUID()
  const event: EngageIQEvent = {
    event_id,
    merchant_id: merchantId,
    customer_id: body.customer_id ?? null,
    anon_id: body.anon_id ?? null,
    event_type: body.event_name,
    properties: body.properties ?? {},
    session_id: null,
    page_url: null,
    ip: null,
    user_agent: null,
    timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
  }

  await insertEvents([event])
  return { event_id }
}
