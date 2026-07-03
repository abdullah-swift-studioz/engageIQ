// apps/api/src/lib/channels/email.adapter.ts
//
// Real email send path behind the frozen ChannelAdapter contract (roadmap 6.4).
// Primary: AWS SES v2 SendEmail, SigV4-signed with native fetch (zero new deps, mirroring
// the WhatsApp adapter). Fallback: Resend, when RESEND_API_KEY is set and SES creds are
// absent. When neither is configured the adapter returns a clean, non-retryable
// "email not configured" result — the app boots credential-free and fails softly,
// exactly like the WhatsApp adapter.
import { env } from '@engageiq/shared'
import type { ChannelAdapter, ChannelSendPayload, ChannelSendResult } from '@engageiq/shared'
import { signSesRequest } from '../../services/email/sigv4.js'

interface SesSuccess {
  MessageId?: string
}
interface SesError {
  message?: string
  Message?: string
  __type?: string
}

export class EmailAdapter implements ChannelAdapter {
  readonly channel = 'EMAIL' as const

  async send(payload: ChannelSendPayload): Promise<ChannelSendResult> {
    if (payload.channel !== 'EMAIL') {
      // The registry guarantees this never happens; guard keeps the type narrow.
      return { ok: false, retryable: false, errorTitle: 'EmailAdapter received non-EMAIL payload' }
    }

    const from = this.fromHeader()
    if (!from) {
      return { ok: false, retryable: false, errorTitle: 'Email not configured (no from address)' }
    }

    const hasSes = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)
    if (hasSes) return this.sendViaSes(payload, from)
    if (env.RESEND_API_KEY) return this.sendViaResend(payload, from)

    // No provider configured — fail cleanly and permanently (mirror WhatsApp adapter).
    return { ok: false, retryable: false, errorTitle: 'Email not configured' }
  }

  private fromHeader(): string | null {
    const address = env.AWS_SES_FROM_EMAIL
    if (!address) return null
    const name = env.EMAIL_FROM_NAME
    return name ? `${name} <${address}>` : address
  }

  private async sendViaSes(
    payload: Extract<ChannelSendPayload, { channel: 'EMAIL' }>,
    from: string,
  ): Promise<ChannelSendResult> {
    const body = JSON.stringify({
      FromEmailAddress: from,
      Destination: { ToAddresses: [payload.toEmail] },
      Content: {
        Simple: {
          Subject: { Data: payload.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: payload.html, Charset: 'UTF-8' },
            Text: { Data: payload.text, Charset: 'UTF-8' },
          },
        },
      },
    })

    const signed = signSesRequest({
      region: env.AWS_REGION,
      accessKeyId: env.AWS_ACCESS_KEY_ID as string,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY as string,
      body,
    })

    let res: Response
    try {
      res = await fetch(signed.url, { method: 'POST', headers: signed.headers, body: signed.body })
    } catch (err) {
      // Network-level failure — transient, retry.
      return { ok: false, retryable: true, errorTitle: err instanceof Error ? err.message : 'SES network error' }
    }

    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as SesSuccess
      if (!json.MessageId) {
        return { ok: false, retryable: false, errorTitle: 'SES response missing MessageId' }
      }
      return { ok: true, providerMessageId: json.MessageId }
    }

    const json = (await res.json().catch(() => ({}))) as SesError
    // 429 (throttling) + 5xx are transient; 4xx (bad address, unverified identity) are permanent.
    const retryable = res.status === 429 || res.status >= 500
    return {
      ok: false,
      retryable,
      errorCode: json.__type ?? String(res.status),
      errorTitle: json.message ?? json.Message ?? `SES send failed (HTTP ${res.status})`,
    }
  }

  private async sendViaResend(
    payload: Extract<ChannelSendPayload, { channel: 'EMAIL' }>,
    from: string,
  ): Promise<ChannelSendResult> {
    let res: Response
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [payload.toEmail],
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        }),
      })
    } catch (err) {
      return { ok: false, retryable: true, errorTitle: err instanceof Error ? err.message : 'Resend network error' }
    }

    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { id?: string }
      if (!json.id) return { ok: false, retryable: false, errorTitle: 'Resend response missing id' }
      return { ok: true, providerMessageId: json.id }
    }

    const json = (await res.json().catch(() => ({}))) as { message?: string; name?: string }
    const retryable = res.status === 429 || res.status >= 500
    return {
      ok: false,
      retryable,
      errorCode: json.name ?? String(res.status),
      errorTitle: json.message ?? `Resend send failed (HTTP ${res.status})`,
    }
  }
}

export const emailAdapter = new EmailAdapter()
