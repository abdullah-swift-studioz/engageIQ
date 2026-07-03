// apps/api/src/lib/channels/sms.adapter.ts
//
// Real SMS send path behind the frozen ChannelAdapter contract (packages/shared/src/
// types.ts §"Channel Dispatch Contract"). Delegates the actual vendor call to a provider
// chain (Twilio global + local PK aggregator) and FAILS OVER between them: on a failure
// from the primary it tries the next configured provider, so a Twilio outage still gets
// the message out via the domestic gateway (and vice-versa).
//
// Never throws for expected provider errors — always returns a typed ChannelSendResult so
// the message-dispatch worker decides retry vs permanent-fail. No credentials anywhere →
// a clean, non-retryable "SMS not configured" (matching the WhatsApp adapter's behaviour).
import type { ChannelAdapter, ChannelSendPayload, ChannelSendResult } from '@engageiq/shared'
import { resolveProviderChain } from './sms-providers/index.js'
import type { SmsProviderResult } from './sms-providers/index.js'

export class SmsAdapter implements ChannelAdapter {
  readonly channel = 'SMS' as const

  async send(payload: ChannelSendPayload): Promise<ChannelSendResult> {
    if (payload.channel !== 'SMS') {
      // The registry guarantees this never happens; guard keeps the type narrow.
      return { ok: false, retryable: false, errorTitle: 'SmsAdapter received non-SMS payload' }
    }

    const chain = resolveProviderChain()
    if (chain.length === 0) {
      // Boots credential-free; sends fail cleanly (non-retryable) until keys are set.
      return { ok: false, retryable: false, errorTitle: 'SMS not configured' }
    }

    // Try each configured provider in order. First success wins. On failure, fall over
    // to the next provider; remember the last failure so we can surface it if all fail.
    let last: Extract<SmsProviderResult, { ok: false }> | undefined
    let anyRetryable = false

    for (const provider of chain) {
      const result = await provider.send(payload.toPhone, payload.body)
      if (result.ok) {
        return { ok: true, providerMessageId: result.providerMessageId }
      }
      last = result
      anyRetryable = anyRetryable || result.retryable
    }

    // Every provider failed. If any failure was transient, report retryable so the
    // worker re-enqueues (BullMQ retry) and the whole chain is tried again later.
    // Otherwise the failure is permanent (e.g. bad number rejected by all providers).
    return {
      ok: false,
      retryable: anyRetryable,
      ...(last?.errorCode !== undefined && { errorCode: last.errorCode }),
      errorTitle: last?.errorTitle ?? 'SMS send failed',
    }
  }
}

export const smsAdapter = new SmsAdapter()
