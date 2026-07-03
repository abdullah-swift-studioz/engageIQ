// apps/api/src/services/email/render.ts
//
// The email render engine (guide 7.3): turns an EmailTemplate's `blocks` (Json) into a
// personalized, mobile-safe HTML email for one recipient, plus a plain-text alternative.
//
// Design constraints for email HTML (very different from the dashboard's monochrome UI —
// merchant email content is fully branded/colored):
//   • Table-based layout, 600px centered container, inline styles (Gmail/Outlook safe).
//   • A <style> block with a mobile media query for fluid width + stacked product grids.
//   • Personalization tokens resolved via ./tokens; token values HTML-escaped.
//   • Dynamic product blocks render from ctx.productsByBlockId (resolved fresh at send time).
//   • Conditional blocks render only when the recipient is in the block's segment.
//
// Pure and deterministic given its inputs — unit-tested without a DB.

import type {
  EmailBlock,
  EmailRenderContext,
  EmailRenderProduct,
} from '@engageiq/shared'
import { substituteTokens } from './tokens.js'

const BODY_WIDTH = 600

// HTML-escape a value being placed into element text / attribute context.
function esc(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function align(a: string | undefined): 'left' | 'center' | 'right' {
  return a === 'center' || a === 'right' ? a : 'left'
}

// A single content block → an HTML table row (<tr>) inside the 600px container.
// Text/personalization tokens are substituted then the raw html is inserted (text block)
// or escaped (attributes/labels).
function renderBlock(block: EmailBlock, ctx: EmailRenderContext): string {
  switch (block.type) {
    case 'text': {
      // Token values inside free HTML are escaped by substituteTokens's callers? No —
      // here the surrounding html is builder-authored; we substitute tokens and escape
      // ONLY the token replacement values to prevent field-injected markup.
      const html = substituteHtmlTokens(block.html, ctx)
      return row(
        `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#333333;text-align:${align(block.align)};">${html}</div>`,
      )
    }

    case 'image': {
      const src = esc(substituteTokens(block.src, ctx))
      const alt = esc(substituteTokens(block.alt ?? '', ctx))
      const width = Math.min(block.width ?? BODY_WIDTH, BODY_WIDTH)
      let img = `<img src="${src}" alt="${alt}" width="${width}" style="display:block;border:0;outline:none;text-decoration:none;max-width:100%;height:auto;margin:0 auto;" />`
      if (block.href) {
        img = `<a href="${esc(substituteTokens(block.href, ctx))}" target="_blank" style="text-decoration:none;">${img}</a>`
      }
      return row(`<div style="text-align:${align(block.align)};">${img}</div>`)
    }

    case 'button': {
      const text = esc(substituteTokens(block.text, ctx))
      const href = esc(substituteTokens(block.href, ctx))
      const btn = `<a href="${href}" target="_blank" style="display:inline-block;background-color:#111111;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:6px;">${text}</a>`
      return row(`<div style="text-align:${align(block.align)};">${btn}</div>`)
    }

    case 'divider':
      return row(
        `<div style="border-top:1px solid #e5e5e5;font-size:1px;line-height:1px;">&nbsp;</div>`,
        '8px 0',
      )

    case 'spacer': {
      const h = Math.max(0, Math.min(block.height, 200))
      return `<tr><td style="height:${h}px;line-height:${h}px;font-size:1px;">&nbsp;</td></tr>`
    }

    case 'dynamic-product': {
      const products = ctx.productsByBlockId[block.id] ?? []
      if (products.length === 0) return ''
      const columns = Math.max(1, Math.min(block.columns ?? 2, 4))
      const heading = block.heading
        ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#111111;padding-bottom:12px;">${esc(substituteTokens(block.heading, ctx))}</div>`
        : ''
      return row(heading + renderProductGrid(products.slice(0, block.limit), columns))
    }

    case 'conditional': {
      // Render children only if the recipient is a member of the target segment.
      if (!ctx.segmentIds.includes(block.segmentId)) return ''
      return block.blocks.map((b) => renderBlock(b, ctx)).join('')
    }

    default:
      // Exhaustiveness guard — a new block type must be handled above.
      return ''
  }
}

// Substitute tokens inside builder HTML, escaping each resolved value so a customer
// field containing markup cannot inject HTML. We escape values by wrapping the token
// resolution: substitute against a proxy that escapes, applied to the raw html.
function substituteHtmlTokens(html: string, ctx: EmailRenderContext): string {
  // Resolve tokens to escaped values. substituteTokens returns raw; re-run through a
  // token-aware pass that escapes replacements only (surrounding html left intact).
  const TOKEN_RE = /\{\{\s*[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+\s*(?:\|[^}]*)?\}\}/g
  return html.replace(TOKEN_RE, (token) => esc(substituteTokens(token, ctx)))
}

// Nested table grid of product cards. Chunks products into rows of `columns`.
function renderProductGrid(products: EmailRenderProduct[], columns: number): string {
  const cellWidth = Math.floor(BODY_WIDTH / columns) - 12
  const rows: string[] = []
  for (let i = 0; i < products.length; i += columns) {
    const cells = products
      .slice(i, i + columns)
      .map((p) => renderProductCard(p, cellWidth))
      .join('')
    rows.push(`<tr>${cells}</tr>`)
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="product-grid"><tbody>${rows.join('')}</tbody></table>`
}

function renderProductCard(p: EmailRenderProduct, width: number): string {
  const href = p.url ? esc(p.url) : '#'
  const img = p.imageUrl
    ? `<a href="${href}" target="_blank"><img src="${esc(p.imageUrl)}" alt="${esc(p.title)}" width="${width}" style="display:block;border:0;max-width:100%;height:auto;border-radius:6px;" /></a>`
    : ''
  const price = p.price
    ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111111;font-weight:bold;padding-top:4px;">${esc(p.price)}</div>`
    : ''
  return `<td valign="top" class="product-cell" style="width:${width}px;padding:6px;font-family:Arial,Helvetica,sans-serif;">
    ${img}
    <div style="font-size:14px;color:#333333;padding-top:8px;"><a href="${href}" target="_blank" style="color:#333333;text-decoration:none;">${esc(p.title)}</a></div>
    ${price}
  </td>`
}

// Wrap block content in a padded container row.
function row(inner: string, padding = '10px 0'): string {
  return `<tr><td style="padding:${padding};">${inner}</td></tr>`
}

export interface RenderedEmail {
  html: string
  text: string
}

export interface RenderEmailInput {
  blocks: EmailBlock[]
  subject: string
  preheader?: string | null
  ctx: EmailRenderContext
}

// Full HTML document + plain-text alternative for one recipient.
export function renderEmail(input: RenderEmailInput): RenderedEmail {
  const { blocks, ctx } = input
  const bodyRows = blocks.map((b) => renderBlock(b, ctx)).join('')
  const preheader = input.preheader ? substituteTokens(input.preheader, ctx) : ''

  const footer = renderFooter(ctx)
  const openPixel = ctx.openTrackingUrl
    ? `<img src="${esc(ctx.openTrackingUrl)}" width="1" height="1" alt="" style="display:block;border:0;" />`
    : ''

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>${esc(substituteTokens(input.subject, ctx))}</title>
<style>
  body { margin:0; padding:0; background-color:#f4f4f5; -webkit-text-size-adjust:100%; }
  table { border-collapse:collapse; }
  img { -ms-interpolation-mode:bicubic; }
  a { color:#111111; }
  @media only screen and (max-width:620px) {
    .container { width:100% !important; }
    .product-cell { display:block !important; width:100% !important; }
  }
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" class="container" width="${BODY_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${BODY_WIDTH}px;max-width:100%;background-color:#ffffff;border-radius:8px;">
        <tr><td style="padding:24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody>
            ${bodyRows}
          </tbody></table>
        </td></tr>
      </table>
      ${footer}
    </td>
  </tr>
</table>
${openPixel}
</body>
</html>`

  return { html, text: renderPlainText(blocks, ctx) }
}

function renderFooter(ctx: EmailRenderContext): string {
  const merchantName = esc(String(ctx.merchant.name ?? 'EngageIQ'))
  const unsub = ctx.unsubscribeUrl
    ? `<a href="${esc(ctx.unsubscribeUrl)}" target="_blank" style="color:#888888;text-decoration:underline;">Unsubscribe</a>`
    : ''
  return `<table role="presentation" width="${BODY_WIDTH}" cellpadding="0" cellspacing="0" border="0" class="container" style="width:${BODY_WIDTH}px;max-width:100%;">
    <tr><td style="padding:16px 24px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#888888;line-height:1.5;">
      Sent by ${merchantName}.<br/>${unsub}
    </td></tr>
  </table>`
}

// Plain-text alternative (deliverability + accessibility). Strips HTML from text blocks.
function renderPlainText(blocks: EmailBlock[], ctx: EmailRenderContext): string {
  const parts: string[] = []
  const walk = (bs: EmailBlock[]): void => {
    for (const b of bs) {
      switch (b.type) {
        case 'text':
          parts.push(stripHtml(substituteTokens(b.html, ctx)))
          break
        case 'button':
          parts.push(`${substituteTokens(b.text, ctx)}: ${substituteTokens(b.href, ctx)}`)
          break
        case 'image':
          if (b.href) parts.push(substituteTokens(b.href, ctx))
          break
        case 'dynamic-product': {
          const products = ctx.productsByBlockId[b.id] ?? []
          for (const p of products.slice(0, b.limit)) {
            parts.push(`${p.title}${p.price ? ` — ${p.price}` : ''}${p.url ? ` ${p.url}` : ''}`)
          }
          break
        }
        case 'conditional':
          if (ctx.segmentIds.includes(b.segmentId)) walk(b.blocks)
          break
        default:
          break
      }
    }
  }
  walk(blocks)
  if (ctx.unsubscribeUrl) parts.push(`Unsubscribe: ${ctx.unsubscribeUrl}`)
  return parts.filter((p) => p.trim() !== '').join('\n\n')
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<\/(p|div|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}
