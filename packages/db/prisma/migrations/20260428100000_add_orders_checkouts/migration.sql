-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "shopify_order_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "total_price" DECIMAL(12,2) NOT NULL,
    "subtotal_price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "financial_status" TEXT,
    "fulfillment_status" TEXT,
    "payment_gateway" TEXT,
    "is_cod" BOOLEAN NOT NULL DEFAULT false,
    "line_items" JSONB NOT NULL,
    "shipping_address" JSONB,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "refunded_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "placed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abandoned_checkouts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "shopify_checkout_token" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "line_items" JSONB NOT NULL,
    "total_price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "abandoned_at" TIMESTAMP(3),
    "recovered_at" TIMESTAMP(3),
    "recovered_order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "abandoned_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_merchant_id_shopify_order_id_key" ON "orders"("merchant_id", "shopify_order_id");
CREATE INDEX "orders_merchant_id_idx" ON "orders"("merchant_id");
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");
CREATE INDEX "orders_merchant_id_placed_at_idx" ON "orders"("merchant_id", "placed_at");
CREATE INDEX "orders_merchant_id_is_cod_idx" ON "orders"("merchant_id", "is_cod");

-- CreateIndex
CREATE UNIQUE INDEX "abandoned_checkouts_merchant_id_shopify_checkout_token_key" ON "abandoned_checkouts"("merchant_id", "shopify_checkout_token");
CREATE INDEX "abandoned_checkouts_merchant_id_idx" ON "abandoned_checkouts"("merchant_id");
CREATE INDEX "abandoned_checkouts_customer_id_idx" ON "abandoned_checkouts"("customer_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abandoned_checkouts" ADD CONSTRAINT "abandoned_checkouts_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "abandoned_checkouts" ADD CONSTRAINT "abandoned_checkouts_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
