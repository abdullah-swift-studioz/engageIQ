import { prisma, clickhouse } from '@engageiq/db'

/**
 * Recompute session_count for a customer by querying ClickHouse for the number
 * of distinct session_ids associated with this customer (by customer_id or any
 * of their known anon_ids). Updates the PostgreSQL customers record.
 *
 * Fire-and-forget safe: wraps in try/catch and never throws.
 */
export async function syncSessionCount(
  merchantId: string,
  customerId: string,
  anonIds: string[],
): Promise<void> {
  try {
    let query: string
    let queryParams: Record<string, unknown>

    if (anonIds.length > 0) {
      query = `
        SELECT uniqExact(session_id) AS session_count
        FROM engageiq.events
        WHERE merchant_id = {merchantId:String}
          AND (customer_id = {customerId:String} OR has({anonIds:Array(String)}, anon_id))
          AND session_id IS NOT NULL
      `
      queryParams = { merchantId, customerId, anonIds }
    } else {
      query = `
        SELECT uniqExact(session_id) AS session_count
        FROM engageiq.events
        WHERE merchant_id = {merchantId:String}
          AND customer_id = {customerId:String}
          AND session_id IS NOT NULL
      `
      queryParams = { merchantId, customerId }
    }

    const result = await clickhouse
      .query({ query, query_params: queryParams, format: 'JSONEachRow' })
      .then((r) => r.json<{ session_count: string }>())

    const rows = Array.isArray(result) ? result : []
    const sessionCount = rows.length > 0 ? parseInt(rows[0]!.session_count, 10) : 0

    await prisma.customer.update({
      where: { id: customerId, merchantId },
      data: { sessionCount },
    })
  } catch (err) {
    // Fire-and-forget — log but never propagate
    console.error({ err, merchantId, customerId }, 'syncSessionCount failed')
  }
}

/**
 * Recompute COD profile statistics (codOrderCount, codAcceptanceRate,
 * codRejectionRate) from the cod_orders table. Updates the PostgreSQL
 * customers record.
 *
 * Fire-and-forget safe: wraps in try/catch and never throws.
 */
export async function recalculateCodProfile(
  merchantId: string,
  customerId: string,
): Promise<void> {
  try {
    const codOrders = await prisma.codOrder.findMany({
      where: { merchantId, customerId },
      select: { status: true },
    })

    const codOrderCount = codOrders.length

    if (codOrderCount === 0) {
      await prisma.customer.update({
        where: { id: customerId, merchantId },
        data: {
          codOrderCount: 0,
          codAcceptanceRate: null,
          codRejectionRate: null,
        },
      })
      return
    }

    const delivered = codOrders.filter((o) => o.status === 'DELIVERED').length
    const rejected = codOrders.filter(
      (o) => o.status === 'RETURNED' || o.status === 'CANCELLED',
    ).length

    const codAcceptanceRate = delivered / codOrderCount
    const codRejectionRate = rejected / codOrderCount

    await prisma.customer.update({
      where: { id: customerId, merchantId },
      data: {
        codOrderCount,
        codAcceptanceRate,
        codRejectionRate,
      },
    })
  } catch (err) {
    // Fire-and-forget — log but never propagate
    console.error({ err, merchantId, customerId }, 'recalculateCodProfile failed')
  }
}
