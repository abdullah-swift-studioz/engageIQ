// apps/api/src/lib/channels/sms.adapter.ts
//
// SMS stub behind the ChannelAdapter contract. Twilio (global) + a PK aggregator
// land in a later wave (roadmap 6.3 SMS half). Until then this returns a clean,
// non-retryable "not implemented" so the worker records FAILED rather than looping.
import type { ChannelAdapter, ChannelSendPayload, ChannelSendResult } from '@engageiq/shared'

export class SmsAdapter implements ChannelAdapter {
  readonly channel = 'SMS' as const

  async send(_payload: ChannelSendPayload): Promise<ChannelSendResult> {
    return { ok: false, retryable: false, errorTitle: 'SMS channel not implemented yet' }
  }
}

export const smsAdapter = new SmsAdapter()
