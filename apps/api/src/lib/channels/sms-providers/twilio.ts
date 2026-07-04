// apps/api/src/lib/channels/sms-providers/twilio.ts
//
// Twilio SMS provider (global). Zero new deps — native fetch + Basic auth, mirroring
// the WhatsApp adapter's native-fetch approach. Posts to the 2010-04-01 Messages API
// and maps HTTP status → retryability so the SmsAdapter can fail over (5xx/429/network
// → retryable/fail-over; 4xx → permanent). Never throws for an expected Twilio error.
import { env } from '@engageiq/shared'
import type { SmsProvider, SmsProviderResult } from './types.js'

// Twilio's success envelope (subset): { sid, status, error_code }.
interface TwilioSendBody {
  sid?: string
  error_code?: number | null
}

// Twilio's error envelope on a 4xx/5xx: { code, message, status, more_info }.
interface TwilioErrorBody {
  code?: number
  message?: string
}

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01'

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio' as const

  // Needs an account SID + auth token, and either a from-number or a messaging service.
  isConfigured(): boolean {
    return Boolean(
      env.TWILIO_ACCOUNT_SID &&
        env.TWILIO_AUTH_TOKEN &&
        (env.TWILIO_FROM_NUMBER || env.TWILIO_MESSAGING_SERVICE_SID),
    )
  }

  async send(to: string, body: string): Promise<SmsProviderResult> {
    // Guarded by isConfigured() in the chain, but keep the send self-safe.
    if (!this.isConfigured()) {
      return { ok: false, retryable: false, errorTitle: 'Twilio not configured' }
    }

    const accountSid = env.TWILIO_ACCOUNT_SID as string
    const authToken = env.TWILIO_AUTH_TOKEN as string
    const url = `${TWILIO_BASE}/Accounts/${accountSid}/Messages.json`

    const form = new URLSearchParams()
    form.set('To', to)
    form.set('Body', body)
    // A Messaging Service SID (sender pool) takes precedence over a single From number.
    if (env.TWILIO_MESSAGING_SERVICE_SID) {
      form.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID)
    } else {
      form.set('From', env.TWILIO_FROM_NUMBER as string)
    }
    // Ask Twilio to POST delivery-status callbacks to our webhook (routes/webhooks/sms.ts).
    if (env.TWILIO_STATUS_CALLBACK_URL) {
      form.set('StatusCallback', env.TWILIO_STATUS_CALLBACK_URL)
    }

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      })
    } catch (err) {
      // Network-level failure (DNS, timeout, connection reset) — transient, fail over/retry.
      return {
        ok: false,
        retryable: true,
        errorTitle: err instanceof Error ? err.message : 'Twilio network error',
      }
    }

    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as TwilioSendBody
      if (!json.sid) {
        return { ok: false, retryable: false, errorTitle: 'Twilio response missing message sid' }
      }
      return { ok: true, providerMessageId: json.sid }
    }

    const json = (await res.json().catch(() => ({}))) as TwilioErrorBody
    const retryable = res.status === 429 || res.status >= 500
    return {
      ok: false,
      retryable,
      errorCode: json.code !== undefined ? String(json.code) : String(res.status),
      errorTitle: json.message ?? `Twilio send failed (HTTP ${res.status})`,
    }
  }
}

export const twilioSmsProvider = new TwilioSmsProvider()
