// apps/api/src/services/cod-verification/prompt.ts
//
// Builds the customer-facing verification message body (guide §7.4). Pure + unit-tested.
// A merchant may override the copy via config.promptTemplate with {{token}} placeholders;
// otherwise a sensible bilingual (Assalam-o-Alaikum greeting + English) default is used.
import type { CodVerificationConfig } from '@engageiq/shared'

export interface VerificationPromptTokens {
  orderNumber: string
  // Numeric order amount (PKR). Formatted with thousands separators in the message.
  amount: number
  // Optional first line-item / product title. Falls back gracefully when absent.
  product?: string | null
  // Optional customer first name for a personalised greeting.
  firstName?: string | null
}

// The default prompt: greeting + order ref + amount + explicit YES/NO instruction. Kept short so
// it fits a WhatsApp quick-reply context and an SMS segment. The {{product}} clause is included
// only when a product is known (handled in substitution below).
const DEFAULT_TEMPLATE =
  'Assalam-o-Alaikum{{firstNameComma}}! We received your order #{{orderNumber}}{{productClause}} ' +
  'worth Rs. {{amount}}. Reply YES to confirm or NO to cancel. (Order #{{orderNumber}})'

// Format a PKR amount with thousands separators and no decimals (whole rupees read cleaner in a
// verification message). Uses a manual grouping so output is deterministic across Node ICU builds.
export function formatPkr(amount: number): string {
  const rounded = Math.round(Number.isFinite(amount) ? amount : 0)
  const sign = rounded < 0 ? '-' : ''
  const digits = Math.abs(rounded).toString()
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${grouped}`
}

/**
 * Substitute {{token}} placeholders in a template. Recognised tokens:
 *   {{orderNumber}} {{amount}} {{product}} {{firstName}}
 * plus two derived convenience tokens used by the default template:
 *   {{firstNameComma}} → ", <first>" when a name is present, else ""
 *   {{productClause}}  → " for <product>" when a product is present, else ""
 * Unknown placeholders are left untouched (so a merchant typo is visible, not silently dropped).
 */
export function renderTemplate(template: string, tokens: VerificationPromptTokens): string {
  const first = (tokens.firstName ?? '').trim()
  const product = (tokens.product ?? '').trim()
  const map: Record<string, string> = {
    orderNumber: tokens.orderNumber,
    amount: formatPkr(tokens.amount),
    product,
    firstName: first,
    firstNameComma: first ? `, ${first}` : '',
    productClause: product ? ` for ${product}` : '',
  }
  return template
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) =>
      Object.prototype.hasOwnProperty.call(map, key) ? map[key]! : whole,
    )
    .replace(/\s+/g, ' ')
    .trim()
}

/** Build the verification prompt body for an order, honouring a merchant override template. */
export function buildVerificationPrompt(
  tokens: VerificationPromptTokens,
  config: CodVerificationConfig,
): string {
  const template =
    config.promptTemplate && config.promptTemplate.trim().length > 0
      ? config.promptTemplate
      : DEFAULT_TEMPLATE
  return renderTemplate(template, tokens)
}
