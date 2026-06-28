// apps/api/src/lib/channels/registry.ts
//
// Single lookup from a ChannelName to its ChannelAdapter. The message-dispatch
// worker resolves the adapter here; PUSH has no adapter yet (returns undefined →
// worker records a clean FAILED). Adding a real SMS/Email adapter is a one-line
// swap of the stub instance — no worker change.
import type { ChannelAdapter, ChannelName } from '@engageiq/shared'
import { whatsappAdapter } from './whatsapp.adapter.js'
import { smsAdapter } from './sms.adapter.js'
import { emailAdapter } from './email.adapter.js'

const adapters: Partial<Record<ChannelName, ChannelAdapter>> = {
  WHATSAPP: whatsappAdapter,
  SMS: smsAdapter,
  EMAIL: emailAdapter,
}

export function getAdapter(channel: ChannelName): ChannelAdapter | undefined {
  return adapters[channel]
}
