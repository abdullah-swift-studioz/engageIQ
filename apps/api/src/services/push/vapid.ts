// apps/api/src/services/push/vapid.ts
//
// Central VAPID configuration for the self-hosted Web Push Protocol. web-push must be
// told the VAPID keypair once (setVapidDetails) before it can sign a push; we do that
// lazily and memoize the result so callers can cheaply check "is push configured?".
//
// The app boots WITHOUT VAPID keys (both env vars are optional). Until they are set, the
// PushAdapter returns a clean "push not configured" result rather than throwing — mirroring
// the WhatsApp adapter's credential-free boot.
import webpush from 'web-push'
import { env } from '@engageiq/shared'

let configured: boolean | null = null

// True when both VAPID keys are present in the environment.
export function isPushConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
}

// Apply the VAPID keypair to web-push exactly once. Returns whether push is usable.
export function ensureVapidConfigured(): boolean {
  if (configured !== null) return configured
  if (!isPushConfigured()) {
    configured = false
    return false
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!)
  configured = true
  return true
}

// The browser-safe public key, handed to the storefront SDK so it can subscribe.
export function getVapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null
}
