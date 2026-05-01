/**
 * Normalize a phone number to E.164 format.
 * Handles Pakistani local format (03XX-XXXXXXX → +92XXXXXXXXXX) and
 * international numbers already in or close to E.164.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const stripped = phone.trim()
  const digits = stripped.replace(/\D/g, '')

  // Pakistani 11-digit local: 0XXXXXXXXXX → +92XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('0')) {
    return `+92${digits.slice(1)}`
  }
  // 12-digit with PK country code: 92XXXXXXXXXX → +92XXXXXXXXXX
  if (digits.length === 12 && digits.startsWith('92')) {
    return `+${digits}`
  }
  // Already has a plus sign and enough digits to be E.164
  if (stripped.startsWith('+') && digits.length >= 10) {
    return `+${digits}`
  }
  return stripped
}

/**
 * Convert a Shopify comma-separated tags string to a clean string array.
 */
export function parseTags(tags: string | undefined | null): string[] {
  if (!tags) return []
  return tags.split(',').map(t => t.trim()).filter(Boolean)
}

/**
 * Detect whether an order is Cash on Delivery based on its payment gateway.
 */
export function detectCod(paymentGateway: string, financialStatus?: string | null): boolean {
  const gw = paymentGateway.toLowerCase().trim()
  return (
    gw === 'cash_on_delivery' ||
    gw === 'cod' ||
    gw === 'cash on delivery' ||
    gw.includes('cash_on_delivery') ||
    // Some merchants use "manual" for COD with pending payment status
    (gw === 'manual' && financialStatus === 'pending')
  )
}
