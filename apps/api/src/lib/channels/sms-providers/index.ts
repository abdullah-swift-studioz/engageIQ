// apps/api/src/lib/channels/sms-providers/index.ts
//
// Builds the ordered SMS provider chain the SmsAdapter fails over across. Only
// configured providers are included; primary is chosen by SMS_PRIMARY_PROVIDER
// (default 'twilio'), with the other provider as the fallback. An empty chain means
// no SMS credentials are set anywhere → the adapter returns "SMS not configured".
import { env } from '@engageiq/shared'
import type { SmsProvider } from './types.js'
import { twilioSmsProvider } from './twilio.js'
import { pkAggregatorSmsProvider } from './pk-aggregator.js'

export type { SmsProvider, SmsProviderResult, SmsProviderName } from './types.js'
export { twilioSmsProvider } from './twilio.js'
export { pkAggregatorSmsProvider } from './pk-aggregator.js'

// Ordered by SMS_PRIMARY_PROVIDER, filtered to those with credentials present.
export function resolveProviderChain(): SmsProvider[] {
  const primaryFirst: SmsProvider[] =
    env.SMS_PRIMARY_PROVIDER === 'pk-aggregator'
      ? [pkAggregatorSmsProvider, twilioSmsProvider]
      : [twilioSmsProvider, pkAggregatorSmsProvider]

  return primaryFirst.filter((p) => p.isConfigured())
}
