// apps/api/src/lib/channels/sms-providers/types.ts
//
// Provider abstraction for the SMS channel. The SmsAdapter (sms.adapter.ts) resolves
// an ordered chain of providers and fails over between them; each provider knows how
// to talk to exactly one vendor (Twilio globally, a local PK aggregator for cheaper
// domestic delivery). Providers never throw for expected vendor errors — they return
// a typed SmsProviderResult so the adapter can decide whether to fail over or retry,
// mirroring the ChannelSendResult contract the adapter itself returns to the worker.

export type SmsProviderName = 'twilio' | 'pk-aggregator'

// Outcome of a single provider send attempt. `retryable` follows the same meaning as
// ChannelSendResult.retryable: a transient failure (network / 429 / 5xx) that is worth
// retrying later, versus a permanent rejection (bad number, unconfigured, 4xx).
export type SmsProviderResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; retryable: boolean; errorCode?: string; errorTitle: string }

export interface SmsProvider {
  readonly name: SmsProviderName
  // True only when every credential this provider needs is present in env. An
  // unconfigured provider is skipped by the chain rather than counted as a failure.
  isConfigured(): boolean
  // Send one message. `to` and `from` are E.164; `body` is the rendered text.
  send(to: string, body: string): Promise<SmsProviderResult>
}
