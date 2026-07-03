import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'

// Resource route (action-only) — server-side proxy for the subject-line open-rate predictor.
// lane:copywriter
export async function action({ request }: ActionFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } }, { status: 400 })
  }

  try {
    const res = await fetch(`${apiUrl}/api/v1/ai/predict-subject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const payload = await res.json()
    return json(payload, { status: res.status })
  } catch {
    return json(
      { success: false, error: { code: 'NETWORK_ERROR', message: 'Could not reach the API.' } },
      { status: 502 },
    )
  }
}
