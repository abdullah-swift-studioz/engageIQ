// apps/api/src/lib/channels/whatsapp.adapter.ts
//
// Real WhatsApp Cloud API send path behind the frozen ChannelAdapter contract
// (packages/shared/src/types.ts §"Channel Dispatch Contract"). Zero new deps —
// native fetch only, mirroring the Shopify integration. Never throws for expected
// Meta errors; always returns a typed ChannelSendResult so the worker decides retry.
import { env } from '@engageiq/shared'
import type {
  ChannelAdapter,
  ChannelSendPayload,
  ChannelSendResult,
  TemplateCategory,
} from '@engageiq/shared'

// Meta's error envelope on a failed Graph API call.
interface MetaErrorBody {
  error?: { code?: number; message?: string; error_data?: { details?: string } }
}

// Successful send envelope: { messages: [{ id: "wamid...." }] }
interface MetaSendBody {
  messages?: Array<{ id?: string }>
}

export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = 'WHATSAPP' as const

  // Endpoint-selection seam (spec change #7). Today every category routes to the
  // standard Cloud API endpoint. A MARKETING-category route (Meta MM Lite /
  // marketing_messages) can later be returned from here WITHOUT touching send().
  // The version is always env.META_API_VERSION — never hardcoded in the URL.
  private resolveEndpoint(_category?: TemplateCategory): string {
    const phoneNumberId = env.META_WHATSAPP_PHONE_NUMBER_ID
    return `https://graph.facebook.com/${env.META_API_VERSION}/${phoneNumberId}/messages`
  }

  async send(payload: ChannelSendPayload): Promise<ChannelSendResult> {
    if (payload.channel !== 'WHATSAPP') {
      // The registry guarantees this never happens; guard keeps the type narrow.
      return { ok: false, retryable: false, errorTitle: 'WhatsAppAdapter received non-WhatsApp payload' }
    }

    if (!env.META_WHATSAPP_TOKEN || !env.META_WHATSAPP_PHONE_NUMBER_ID) {
      // App boots credential-free; the send fails cleanly until real keys are set.
      return { ok: false, retryable: false, errorTitle: 'WhatsApp not configured' }
    }

    const body = this.buildMetaPayload(payload)
    const url = this.resolveEndpoint(payload.category)

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.META_WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      // Network-level failure (DNS, timeout, connection reset) — transient, retry.
      return {
        ok: false,
        retryable: true,
        errorTitle: err instanceof Error ? err.message : 'WhatsApp network error',
      }
    }

    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as MetaSendBody
      const wamid = json.messages?.[0]?.id
      if (!wamid) {
        return { ok: false, retryable: false, errorTitle: 'Meta response missing message id' }
      }
      return { ok: true, providerMessageId: wamid }
    }

    // Error path — parse Meta's envelope and decide retryability by HTTP status.
    const json = (await res.json().catch(() => ({}))) as MetaErrorBody
    const retryable = res.status === 429 || res.status >= 500
    return {
      ok: false,
      retryable,
      errorCode: json.error?.code !== undefined ? String(json.error.code) : String(res.status),
      errorTitle: json.error?.message ?? `WhatsApp send failed (HTTP ${res.status})`,
    }
  }

  // Build the Meta Cloud API request body for a template or free-form message.
  private buildMetaPayload(
    payload: Extract<ChannelSendPayload, { channel: 'WHATSAPP' }>,
  ): Record<string, unknown> {
    const base = { messaging_product: 'whatsapp', to: payload.toPhone }

    if (payload.templateName) {
      return {
        ...base,
        type: 'template',
        template: {
          name: payload.templateName,
          language: { code: payload.languageCode ?? 'en' },
          components: [
            {
              type: 'body',
              parameters: (payload.variables ?? []).map((text) => ({ type: 'text', text })),
            },
          ],
        },
      }
    }

    // Free-form text inside the 24h customer-service window.
    return {
      ...base,
      type: 'text',
      text: { body: payload.freeFormText ?? '' },
    }
  }
}

export const whatsappAdapter = new WhatsAppAdapter()
