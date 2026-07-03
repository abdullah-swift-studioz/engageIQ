import { getClickHouseClient } from '@engageiq/db'
import { ONSITE_IMPRESSION_EVENT, ONSITE_CONVERSION_EVENT } from '@engageiq/shared'

export interface OnSiteElementStats {
  impressions: number
  conversions: number
  conversionRate: number // 0..1, 0 when there are no impressions
  // Per-variant breakdown, present only when the element ran / is running an A/B test.
  variants: OnSiteVariantStat[]
  // False when ClickHouse is unreachable — the UI shows "stats unavailable"
  // instead of a misleading zero. All the counters above are 0 in that case.
  available: boolean
}

export interface OnSiteVariantStat {
  variantId: string
  impressions: number
  conversions: number
  conversionRate: number
}

interface CountRow {
  event_type: string
  variant_id: string
  c: string
}

function rate(conversions: number, impressions: number): number {
  return impressions > 0 ? conversions / impressions : 0
}

/**
 * Impression / conversion counts for one element, recomputed from ClickHouse
 * (the frozen `impression_count` / `conversion_count` columns are placeholders).
 *
 * Reads the shared `engageiq.events` table via the exported ClickHouse client
 * (the sanctioned escape hatch — this service never imports `@clickhouse/client`
 * directly). Fully ClickHouse-independent: if CH is down the call resolves to a
 * zeroed result with `available: false` rather than throwing.
 */
export async function getElementStats(
  merchantId: string,
  elementId: string,
): Promise<OnSiteElementStats> {
  const empty: OnSiteElementStats = {
    impressions: 0,
    conversions: 0,
    conversionRate: 0,
    variants: [],
    available: false,
  }

  try {
    const client = getClickHouseClient()
    const result = await client.query({
      query: `
        SELECT
          event_type,
          JSONExtractString(properties, 'variant_id') AS variant_id,
          count() AS c
        FROM engageiq.events
        WHERE merchant_id = {merchantId:String}
          AND event_type IN ({impression:String}, {conversion:String})
          AND JSONExtractString(properties, 'element_id') = {elementId:String}
        GROUP BY event_type, variant_id
      `,
      query_params: {
        merchantId,
        elementId,
        impression: ONSITE_IMPRESSION_EVENT,
        conversion: ONSITE_CONVERSION_EVENT,
      },
      format: 'JSONEachRow',
    })
    const rows = await result.json<CountRow>()

    let impressions = 0
    let conversions = 0
    const perVariant = new Map<string, { impressions: number; conversions: number }>()

    for (const row of rows) {
      const n = Number(row.c)
      const isImpression = row.event_type === ONSITE_IMPRESSION_EVENT
      if (isImpression) impressions += n
      else conversions += n

      if (row.variant_id) {
        const entry = perVariant.get(row.variant_id) ?? { impressions: 0, conversions: 0 }
        if (isImpression) entry.impressions += n
        else entry.conversions += n
        perVariant.set(row.variant_id, entry)
      }
    }

    const variants: OnSiteVariantStat[] = [...perVariant.entries()].map(([variantId, v]) => ({
      variantId,
      impressions: v.impressions,
      conversions: v.conversions,
      conversionRate: rate(v.conversions, v.impressions),
    }))

    return {
      impressions,
      conversions,
      conversionRate: rate(conversions, impressions),
      variants,
      available: true,
    }
  } catch {
    // ClickHouse unreachable (e.g. local stack without CH) — degrade gracefully.
    return empty
  }
}
