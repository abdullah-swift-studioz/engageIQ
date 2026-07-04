// apps/api/src/lib/channels/sms-providers/pk-aggregator.ts
//
// Local Pakistan SMS aggregator provider (domestic fallback — cheaper per-message and
// better deliverability to local/feature phones than Twilio's international route).
//
// The concrete vendor is not yet chosen (ORCHESTRATION.md §13 decision 5 is still open),
// so this implements the shape common to PK bulk-SMS gateways (BrandTxt, Veevo, Telenor
// bulk, etc.): a single JSON POST with { to, from, message } authenticated by an API key,
// returning a message id. Point PK_SMS_API_URL at the vendor and adjust the field names
// here when the vendor is picked — the SmsAdapter/worker above it never change.
import { env } from '@engageiq/shared'
import type { SmsProvider, SmsProviderResult } from './types.js'

// Generic aggregator response — accept the common id field spellings.
interface PkSendBody {
  id?: string | number
  message_id?: string | number
  messageId?: string | number
  status?: string
  error?: string
  message?: string
}

export class PkAggregatorSmsProvider implements SmsProvider {
  readonly name = 'pk-aggregator' as const

  // Needs an endpoint URL + API key. Sender id is optional (some gateways use a
  // masked/short-code sender configured account-side).
  isConfigured(): boolean {
    return Boolean(env.PK_SMS_API_URL && env.PK_SMS_API_KEY)
  }

  async send(to: string, body: string): Promise<SmsProviderResult> {
    if (!this.isConfigured()) {
      return { ok: false, retryable: false, errorTitle: 'PK SMS aggregator not configured' }
    }

    const url = env.PK_SMS_API_URL as string
    const payload: Record<string, string> = {
      to,
      message: body,
      ...(env.PK_SMS_SENDER_ID ? { from: env.PK_SMS_SENDER_ID } : {}),
    }

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.PK_SMS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    } catch (err) {
      return {
        ok: false,
        retryable: true,
        errorTitle: err instanceof Error ? err.message : 'PK SMS network error',
      }
    }

    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as PkSendBody
      const id = json.id ?? json.message_id ?? json.messageId
      if (id === undefined || id === null || id === '') {
        return { ok: false, retryable: false, errorTitle: 'PK SMS response missing message id' }
      }
      return { ok: true, providerMessageId: `pk_${String(id)}` }
    }

    const json = (await res.json().catch(() => ({}))) as PkSendBody
    const retryable = res.status === 429 || res.status >= 500
    return {
      ok: false,
      retryable,
      errorCode: String(res.status),
      errorTitle: json.error ?? json.message ?? `PK SMS send failed (HTTP ${res.status})`,
    }
  }
}

export const pkAggregatorSmsProvider = new PkAggregatorSmsProvider()
