// apps/api/src/services/cod-verification/config.ts
//
// Per-merchant COD verification config (guide §7.4). Stored as free-form Json on
// MerchantSettings.codVerification; this module is the ONLY place that shape is trusted.
// resolveCodVerificationConfig() coerces any raw Json (or null) into a valid, defaulted
// CodVerificationConfig — never throws, always returns a runnable ladder. Pure + exported
// so the worker, the analytics service, and the unit tests all agree on the same defaults.
import type {
  CodVerificationConfig,
  CodVerificationAttemptConfig,
  VerificationChannelName,
} from '@engageiq/shared'

// A CodVerificationConfig that has passed through resolveCodVerificationConfig() — i.e. all
// invariants (non-empty sorted attempts, autoCancel >= last attempt) are guaranteed. Same shape;
// the alias documents intent at call sites that require a validated config.
export type CodVerificationConfigResolved = CodVerificationConfig

const VALID_CHANNELS: readonly VerificationChannelName[] = ['WHATSAPP', 'SMS', 'IVR']

// The guide's recommended ladder: 15min WhatsApp → 2h WhatsApp reminder → 4h escalate to SMS,
// then auto-cancel at 6h if still unconfirmed.
export const DEFAULT_COD_VERIFICATION_CONFIG: CodVerificationConfig = {
  enabled: true,
  attempts: [
    { delayMinutes: 15, channel: 'WHATSAPP' },
    { delayMinutes: 120, channel: 'WHATSAPP' },
    { delayMinutes: 240, channel: 'SMS' },
  ],
  autoCancelDelayMinutes: 360,
  autoCancel: true,
}

function isChannel(v: unknown): v is VerificationChannelName {
  return typeof v === 'string' && (VALID_CHANNELS as readonly string[]).includes(v)
}

function posInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback
}

// Coerce the raw `attempts` array. Drops malformed entries, keeps valid ones, and sorts by
// ascending delay so the escalation ladder is monotonic. Falls back to the default ladder if
// nothing usable remains.
function resolveAttempts(raw: unknown): CodVerificationAttemptConfig[] {
  if (!Array.isArray(raw)) return DEFAULT_COD_VERIFICATION_CONFIG.attempts
  const cleaned: CodVerificationAttemptConfig[] = []
  for (const entry of raw) {
    const e = (entry ?? {}) as Record<string, unknown>
    if (!isChannel(e.channel)) continue
    if (typeof e.delayMinutes !== 'number' || !Number.isFinite(e.delayMinutes) || e.delayMinutes < 0) {
      continue
    }
    cleaned.push({ delayMinutes: Math.floor(e.delayMinutes), channel: e.channel })
  }
  if (cleaned.length === 0) return DEFAULT_COD_VERIFICATION_CONFIG.attempts
  return cleaned.sort((a, b) => a.delayMinutes - b.delayMinutes)
}

/**
 * Resolve the merchant's COD verification config from MerchantSettings.codVerification (raw Json,
 * possibly null/garbage) into a valid, defaulted CodVerificationConfig. Never throws.
 *
 * Invariants guaranteed on the returned value:
 *  - attempts is non-empty and sorted ascending by delayMinutes.
 *  - autoCancelDelayMinutes >= the last attempt's delay (a finalize can never precede the last send).
 */
export function resolveCodVerificationConfig(raw: unknown): CodVerificationConfig {
  const r = (raw ?? {}) as Record<string, unknown>
  const attempts = resolveAttempts(r.attempts)
  const lastDelay = attempts[attempts.length - 1]!.delayMinutes

  const autoCancelDelayMinutes = Math.max(
    posInt(r.autoCancelDelayMinutes, DEFAULT_COD_VERIFICATION_CONFIG.autoCancelDelayMinutes),
    lastDelay,
  )

  const config: CodVerificationConfig = {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_COD_VERIFICATION_CONFIG.enabled,
    attempts,
    autoCancelDelayMinutes,
    autoCancel: typeof r.autoCancel === 'boolean' ? r.autoCancel : DEFAULT_COD_VERIFICATION_CONFIG.autoCancel,
  }
  if (typeof r.promptTemplate === 'string' && r.promptTemplate.trim().length > 0) {
    config.promptTemplate = r.promptTemplate
  }
  if (typeof r.whatsappTemplateId === 'string' && r.whatsappTemplateId.trim().length > 0) {
    config.whatsappTemplateId = r.whatsappTemplateId
  }
  return config
}

/**
 * The channel for a 1-based attempt number, per the resolved ladder. Attempts beyond the ladder's
 * length reuse the LAST configured channel (defensive — the worker never schedules past the ladder,
 * but callers computing a channel for an arbitrary attemptNumber stay in bounds).
 */
export function channelForAttempt(config: CodVerificationConfig, attemptNumber: number): VerificationChannelName {
  const idx = Math.min(Math.max(attemptNumber, 1), config.attempts.length) - 1
  return config.attempts[idx]!.channel
}

/**
 * The absolute offset (minutes from enrollment) at which attempt `attemptNumber` (1-based) fires.
 * Out-of-range numbers clamp to the ladder ends.
 */
export function delayForAttempt(config: CodVerificationConfig, attemptNumber: number): number {
  const idx = Math.min(Math.max(attemptNumber, 1), config.attempts.length) - 1
  return config.attempts[idx]!.delayMinutes
}
