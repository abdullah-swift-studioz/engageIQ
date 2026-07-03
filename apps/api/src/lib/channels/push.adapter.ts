// apps/api/src/lib/channels/push.adapter.ts
//
// Self-hosted Web Push Protocol send path behind the frozen ChannelAdapter contract
// (packages/shared/src/types.ts §"Channel Dispatch Contract"). One send() delivers ONE
// notification to ONE browser subscription; the push-send worker / message-dispatch PUSH
// branch fan out one call per active PushSubscription row.
//
// Never throws for expected push-service errors — always returns a typed ChannelSendResult
// so the caller decides retry vs prune. A 404/410 (subscription gone) is surfaced with
// errorCode 'GONE' so the caller prunes the dead subscription.
import webpush from 'web-push'
import type { ChannelAdapter, ChannelSendPayload, ChannelSendResult } from '@engageiq/shared'
import { ensureVapidConfigured } from '../../services/push/vapid.js'

// web-push throws a WebPushError carrying the push-service HTTP status on failure.
interface WebPushErrorLike {
  statusCode?: number
  message?: string
}

export class PushAdapter implements ChannelAdapter {
  readonly channel = 'PUSH' as const

  async send(payload: ChannelSendPayload): Promise<ChannelSendResult> {
    if (payload.channel !== 'PUSH') {
      // The caller guarantees this never happens; guard keeps the type narrow.
      return { ok: false, retryable: false, errorTitle: 'PushAdapter received non-PUSH payload' }
    }

    if (!ensureVapidConfigured()) {
      // App boots credential-free; the send fails cleanly until VAPID keys are set.
      return { ok: false, retryable: false, errorTitle: 'Push not configured' }
    }

    const { subscription, notification } = payload
    const body = JSON.stringify({
      title: notification.title,
      body: notification.body,
      ...(notification.url ? { url: notification.url } : {}),
      ...(notification.icon ? { icon: notification.icon } : {}),
    })

    try {
      const res = await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: subscription.keys },
        body,
        // Ask the push service to hold the message up to 24h if the device is offline.
        { TTL: 60 * 60 * 24 },
      )
      // Web Push has no provider message id; surface the service's Location header when
      // present, else the endpoint, purely for traceability. Not persisted as a unique id.
      const location = (res.headers as Record<string, string> | undefined)?.location
      return { ok: true, providerMessageId: location || subscription.endpoint }
    } catch (err) {
      const e = err as WebPushErrorLike
      const statusCode = e.statusCode
      const message = e.message ?? (err instanceof Error ? err.message : 'Web Push send failed')

      if (statusCode === 404 || statusCode === 410) {
        // Subscription expired / user unsubscribed — the caller must prune it.
        return { ok: false, retryable: false, errorCode: 'GONE', errorTitle: message }
      }
      if (statusCode === undefined) {
        // Network-level failure (DNS, timeout, reset) — transient.
        return { ok: false, retryable: true, errorTitle: message }
      }
      // 429 / 5xx are transient; other 4xx (400 malformed, 401/403 auth) are permanent.
      const retryable = statusCode === 429 || statusCode >= 500
      return { ok: false, retryable, errorCode: String(statusCode), errorTitle: message }
    }
  }
}

export const pushAdapter = new PushAdapter()
