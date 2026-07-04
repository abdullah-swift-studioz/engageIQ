// apps/api/src/lib/conversations/verification.ts
//
// The "verification" conversation context: COD order verification over WhatsApp (guide §7.4). This
// lane owns the CONVERSATION — matching the inbound reply and resolving conversation state. The COD
// verify lane (roadmap 6.4/7.4, not built yet) owns the ORDER SIDE: it will send the verification
// prompt (opening this conversation with contextType='verification', contextId=<codOrderId>) and
// act on the confirm/cancel decision (dispatch vs auto-cancel).
//
// HAND-OFF SEAM: we deliberately do NOT enqueue onto the COD_VERIFICATION queue here — that worker
// does not exist in this lane, so a job would pile up unconsumed. Instead we classify + resolve the
// conversation and emit a structured log line the COD lane will replace with its own consumer
// (reading the classified reply off the inbound Message + this conversation's contextId). No schema
// or cross-lane queue coupling is introduced.
import type { WhatsAppConversation } from '@prisma/client'
import { classifyVerificationReply } from './keywords.js'
import { claimStructuredReply, closeConversation } from './state.js'

// Route an inbound reply for a verification conversation. Classifies confirm/cancel; an ambiguous
// (UNKNOWN) reply is left un-claimed so the customer can retry until the timeout. On a decisive
// reply we claim it (AWAITING_REPLY → OPEN), close the conversation, and hand off the decision.
export async function resolveVerificationReply(
  convo: WhatsAppConversation,
  text: string,
): Promise<void> {
  const decision = classifyVerificationReply(text)
  if (decision === 'UNKNOWN') return // ambiguous — keep awaiting

  const claimed = await claimStructuredReply(convo.id)
  if (!claimed) return // lost the race to the timeout

  await closeConversation(convo.id)

  // SEAM → COD verify lane. Replace this log with a call into the COD service once that lane lands.
  console.info(
    `[wa-conversation] verification reply resolved decision=${decision} ` +
      `contextId=${convo.contextId ?? 'none'} conversationId=${convo.id} merchantId=${convo.merchantId}`,
  )
}

// Called by the timeout worker once it has atomically expired a verification conversation. The COD
// lane owns reminders / auto-cancel; here we only surface the timeout for it to pick up.
export async function verificationTimeout(convo: WhatsAppConversation): Promise<void> {
  // SEAM → COD verify lane (no-response handling lives there).
  console.info(
    `[wa-conversation] verification timeout contextId=${convo.contextId ?? 'none'} ` +
      `conversationId=${convo.id} merchantId=${convo.merchantId}`,
  )
}
