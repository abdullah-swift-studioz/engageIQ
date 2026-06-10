// apps/api/src/lib/channels/dispatcher.ts
import type { ActionStepConfig } from '@engageiq/shared'

export async function dispatchChannel(
  channel: ActionStepConfig['channel'],
  customerId: string,
  content: ActionStepConfig['content'],
  merchantId: string,
): Promise<void> {
  // Phase 4.2 stub — logs dispatch intent. Phase 5 replaces this body with
  // real Meta Cloud API / AWS SES / Twilio calls without touching callers.
  console.info(
    JSON.stringify({
      level: 'info',
      msg: '[channel-dispatch] stub',
      channel,
      customerId,
      merchantId,
      subject: content.subject ?? null,
      bodyLength: content.body.length,
    }),
  )
}
