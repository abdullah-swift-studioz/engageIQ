// apps/api/src/lib/channels/email.adapter.ts
//
// Email stub behind the ChannelAdapter contract. AWS SES (Resend fallback) arrives
// in roadmap 6.4 (Email + COD verification), which extends this lane in a later wave.
import type { ChannelAdapter, ChannelSendPayload, ChannelSendResult } from '@engageiq/shared'

export class EmailAdapter implements ChannelAdapter {
  readonly channel = 'EMAIL' as const

  async send(_payload: ChannelSendPayload): Promise<ChannelSendResult> {
    return { ok: false, retryable: false, errorTitle: 'Email channel not implemented yet' }
  }
}

export const emailAdapter = new EmailAdapter()
