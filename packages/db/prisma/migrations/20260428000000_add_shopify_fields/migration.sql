-- AlterTable
ALTER TABLE "merchants"
  ADD COLUMN "shopify_scope" TEXT,
  ADD COLUMN "shopify_installed_at" TIMESTAMP(3),
  ADD COLUMN "shopify_uninstalled_at" TIMESTAMP(3);
