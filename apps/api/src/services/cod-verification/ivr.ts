// apps/api/src/services/cod-verification/ivr.ts
//
// Fixerr AI IVR adapter for COD verification voice calls (guide §7.4 Option C): an automated
// Urdu voice call — "press 1 to confirm, 2 to cancel". Creds come from env (FIXERR_*).
//
// GRACEFUL DEGRADATION: with no creds the call is mocked/skipped (returns { status: 'mocked' }) —
// it NEVER fabricates a confirm/cancel decision. The order simply stays awaiting so the escalation
// ladder proceeds to its final auto-cancel. This lane does not wire the inbound DTMF callback
// (there is no Fixerr webhook route here), so even a real placed call resolves via the timeout
// path, not a synchronous decision — documented as a known gap.
import { env } from '@engageiq/shared'

export type IvrPlaceResult =
  // Call accepted by Fixerr; awaiting the customer's DTMF response (resolved by finalize, not inline).
  | { status: 'placed'; callId: string }
  // No Fixerr creds configured → mocked/skipped, no external call made.
  | { status: 'mocked' }
  // The Fixerr API rejected the request or was unreachable.
  | { status: 'failed'; error: string }

export interface IvrCallInput {
  toPhone: string
  orderNumber: string
  amount: number
  // BCP-47-ish hint for the Fixerr flow (default Urdu). The flow id itself carries the script.
  language?: string
}

/** True when enough Fixerr config is present to attempt a real call. */
export function isIvrConfigured(): boolean {
  return Boolean(env.FIXERR_API_URL && env.FIXERR_API_KEY && env.FIXERR_IVR_FLOW_ID)
}

/**
 * Place a Fixerr IVR verification call. Best-effort; resolves (never rejects) so a Fixerr outage
 * can never break the escalation worker — a failed/mocked call just advances the ladder.
 */
export async function placeIvrCall(input: IvrCallInput): Promise<IvrPlaceResult> {
  if (!isIvrConfigured()) {
    console.info(
      JSON.stringify({
        level: 'info',
        msg: '[cod-verify] IVR mocked (no Fixerr creds)',
        orderNumber: input.orderNumber,
        toPhone: input.toPhone,
      }),
    )
    return { status: 'mocked' }
  }

  try {
    const res = await fetch(`${env.FIXERR_API_URL!.replace(/\/$/, '')}/calls`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.FIXERR_API_KEY!}`,
      },
      body: JSON.stringify({
        flowId: env.FIXERR_IVR_FLOW_ID,
        to: input.toPhone,
        language: input.language ?? 'ur',
        variables: {
          orderNumber: input.orderNumber,
          amount: input.amount,
        },
        ...(env.FIXERR_CALLBACK_URL ? { callbackUrl: env.FIXERR_CALLBACK_URL } : {}),
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { status: 'failed', error: `Fixerr responded ${res.status}: ${body.slice(0, 200)}` }
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string; callId?: string }
    const callId = data.callId ?? data.id ?? 'unknown'
    return { status: 'placed', callId }
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
}
