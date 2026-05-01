import { redisConnection } from '@engageiq/queue'
import type { ShopifyProductPayload, ShopifyInventoryPayload, ShopifyProductVariant } from '@engageiq/shared'

// 24-hour cache TTL — products change infrequently; updates are webhook-driven
const PRODUCT_TTL_SECONDS = 86_400

export async function processProductUpdate(
  merchantId: string,
  payload: ShopifyProductPayload,
): Promise<void> {
  const key = `product:${merchantId}:${payload.id}`
  const value = JSON.stringify({
    id: payload.id,
    title: payload.title,
    handle: payload.handle,
    vendor: payload.vendor ?? null,
    productType: payload.product_type ?? null,
    variants: payload.variants.map((v: ShopifyProductVariant) => ({
      id: v.id,
      title: v.title,
      price: v.price,
      sku: v.sku ?? null,
      inventoryQuantity: v.inventory_quantity,
      inventoryItemId: v.inventory_item_id,
    })),
    imageUrl: payload.images[0]?.src ?? null,
    updatedAt: payload.updated_at,
  })
  await redisConnection.set(key, value, 'EX', PRODUCT_TTL_SECONDS)
}

export async function processInventoryUpdate(
  merchantId: string,
  payload: ShopifyInventoryPayload,
): Promise<void> {
  const key = `inventory:${merchantId}:${payload.inventory_item_id}:${payload.location_id}`
  const value = JSON.stringify({
    inventoryItemId: payload.inventory_item_id,
    locationId: payload.location_id,
    available: payload.available,
    updatedAt: payload.updated_at,
  })
  await redisConnection.set(key, value, 'EX', PRODUCT_TTL_SECONDS)
}
