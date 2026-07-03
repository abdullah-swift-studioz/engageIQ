-- CreateEnum
CREATE TYPE "Courier" AS ENUM ('POSTEX', 'LEOPARDS', 'TCS', 'MP', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationChannel" AS ENUM ('WHATSAPP', 'SMS', 'IVR');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'AWAITING', 'CONFIRMED', 'CANCELLED', 'NO_RESPONSE', 'FAILED');

-- CreateEnum
CREATE TYPE "OnSiteElementType" AS ENUM ('POPUP', 'STICKY_BAR', 'EMBED');

-- CreateEnum
CREATE TYPE "AbTestStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'WINNER_DECIDED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AbTestEntityType" AS ENUM ('CAMPAIGN', 'EMAIL_TEMPLATE', 'ONSITE_ELEMENT');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('CREATED', 'DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'ATTEMPTED', 'DELIVERED', 'RETURN_IN_TRANSIT', 'RETURNED', 'UNDELIVERABLE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WhatsAppConversationState" AS ENUM ('OPEN', 'AWAITING_REPLY', 'CLOSED', 'EXPIRED');

-- NOTE: prisma migrate dev wants to DROP INDEX "customers_anon_ids_idx" here because the GIN index
-- on customers.anon_ids lives only in raw migration SQL (20260429100000_add_anon_ids_to_customers)
-- and is not expressible in the Prisma model. The DROP was intentionally removed so the index
-- persists (same fix as commits 7552054 and the phase0 freeze 20260628172239). Do not re-add it.

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "campaign_recipients" ADD COLUMN     "ab_variant_id" TEXT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "is_subscribed_push" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "next_best_action" TEXT;

-- AlterTable
ALTER TABLE "journeys" ADD COLUMN     "source_flow_template_key" TEXT;

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "current_period_end" TIMESTAMP(3),
ADD COLUMN     "price_override" DECIMAL(12,2),
ADD COLUMN     "shopify_charge_id" TEXT,
ADD COLUMN     "subscription_status" TEXT,
ADD COLUMN     "trial_ends_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "body_html" TEXT,
ADD COLUMN     "clicked_at" TIMESTAMP(3),
ADD COLUMN     "email_template_id" TEXT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "opened_at" TIMESTAMP(3),
ADD COLUMN     "subject" TEXT,
ADD COLUMN     "to_email" TEXT;

-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "preheader" TEXT,
    "blocks" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "is_transactional" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "suppressed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sending_domains" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dkim_verified" BOOLEAN NOT NULL DEFAULT false,
    "spf_verified" BOOLEAN NOT NULL DEFAULT false,
    "dmarc_verified" BOOLEAN NOT NULL DEFAULT false,
    "dns_records" JSONB,
    "dedicated_ip" TEXT,
    "ses_identity_arn" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sending_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ab_tests" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity_type" "AbTestEntityType" NOT NULL,
    "entity_id" TEXT,
    "variants" JSONB NOT NULL,
    "winner_metric" TEXT NOT NULL,
    "winner_variant_id" TEXT,
    "status" "AbTestStatus" NOT NULL DEFAULT 'DRAFT',
    "sample_size_pct" INTEGER,
    "confidence_level" DOUBLE PRECISION,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onsite_elements" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OnSiteElementType" NOT NULL,
    "config" JSONB NOT NULL,
    "segment_id" TEXT,
    "display_rules" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER,
    "impression_count" INTEGER NOT NULL DEFAULT 0,
    "conversion_count" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onsite_elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_attempts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "cod_order_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "channel" "VerificationChannel" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "sent_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "response" TEXT,
    "message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_conversations" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "phone" TEXT NOT NULL,
    "context_type" TEXT NOT NULL,
    "context_id" TEXT,
    "awaiting_reply_until" TIMESTAMP(3),
    "state" "WhatsAppConversationState" NOT NULL DEFAULT 'OPEN',
    "last_inbound_at" TIMESTAMP(3),
    "last_outbound_at" TIMESTAMP(3),
    "journey_enrollment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "graph_json" JSONB NOT NULL,
    "channels" "Channel"[],
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "icon" TEXT,
    "preview_image_url" TEXT,
    "sort_order" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "user_agent" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_shipments" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "order_id" TEXT,
    "cod_order_id" TEXT,
    "customer_id" TEXT,
    "courier" "Courier" NOT NULL,
    "tracking_number" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'CREATED',
    "cod_amount" DECIMAL(12,2),
    "cod_collected" BOOLEAN NOT NULL DEFAULT false,
    "cod_collected_at" TIMESTAMP(3),
    "return_reason" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "raw_tracking" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_events" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "description" TEXT,
    "external_id" TEXT,
    "raw" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_webhooks" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secret" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status_code" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "next_retry_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_assignments" (
    "id" TEXT NOT NULL,
    "agency_merchant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "child_merchant_id" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_integrations" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentials" JSONB NOT NULL,
    "config" JSONB,
    "external_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "connected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_settings" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "cod_verification" JSONB,
    "fake_order_thresholds" JSONB,
    "attribution_windows" JSONB,
    "email_defaults" JSONB,
    "branding" JSONB,
    "extra" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_generations" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "purpose" TEXT NOT NULL,
    "channel" TEXT,
    "language" TEXT,
    "context_json" JSONB,
    "variants" JSONB NOT NULL,
    "chosen_index" INTEGER,
    "model" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "cost_usd" DECIMAL(10,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_templates_merchant_id_idx" ON "email_templates"("merchant_id");

-- CreateIndex
CREATE INDEX "email_suppressions_merchant_id_idx" ON "email_suppressions"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_suppressions_merchant_id_email_key" ON "email_suppressions"("merchant_id", "email");

-- CreateIndex
CREATE INDEX "sending_domains_merchant_id_idx" ON "sending_domains"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sending_domains_merchant_id_domain_key" ON "sending_domains"("merchant_id", "domain");

-- CreateIndex
CREATE INDEX "ab_tests_merchant_id_idx" ON "ab_tests"("merchant_id");

-- CreateIndex
CREATE INDEX "ab_tests_merchant_id_entity_type_entity_id_idx" ON "ab_tests"("merchant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "onsite_elements_merchant_id_idx" ON "onsite_elements"("merchant_id");

-- CreateIndex
CREATE INDEX "onsite_elements_merchant_id_status_idx" ON "onsite_elements"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "onsite_elements_segment_id_idx" ON "onsite_elements"("segment_id");

-- CreateIndex
CREATE INDEX "verification_attempts_merchant_id_idx" ON "verification_attempts"("merchant_id");

-- CreateIndex
CREATE INDEX "verification_attempts_merchant_id_status_idx" ON "verification_attempts"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "verification_attempts_cod_order_id_idx" ON "verification_attempts"("cod_order_id");

-- CreateIndex
CREATE INDEX "verification_attempts_customer_id_idx" ON "verification_attempts"("customer_id");

-- CreateIndex
CREATE INDEX "verification_attempts_message_id_idx" ON "verification_attempts"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_attempts_cod_order_id_attempt_number_key" ON "verification_attempts"("cod_order_id", "attempt_number");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_merchant_id_idx" ON "whatsapp_conversations"("merchant_id");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_merchant_id_phone_idx" ON "whatsapp_conversations"("merchant_id", "phone");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_customer_id_idx" ON "whatsapp_conversations"("customer_id");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_journey_enrollment_id_idx" ON "whatsapp_conversations"("journey_enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "flow_templates_key_key" ON "flow_templates"("key");

-- CreateIndex
CREATE INDEX "flow_templates_category_idx" ON "flow_templates"("category");

-- CreateIndex
CREATE INDEX "push_subscriptions_merchant_id_idx" ON "push_subscriptions"("merchant_id");

-- CreateIndex
CREATE INDEX "push_subscriptions_customer_id_idx" ON "push_subscriptions"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_merchant_id_endpoint_key" ON "push_subscriptions"("merchant_id", "endpoint");

-- CreateIndex
CREATE INDEX "courier_shipments_merchant_id_idx" ON "courier_shipments"("merchant_id");

-- CreateIndex
CREATE INDEX "courier_shipments_merchant_id_status_idx" ON "courier_shipments"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "courier_shipments_order_id_idx" ON "courier_shipments"("order_id");

-- CreateIndex
CREATE INDEX "courier_shipments_cod_order_id_idx" ON "courier_shipments"("cod_order_id");

-- CreateIndex
CREATE INDEX "courier_shipments_customer_id_idx" ON "courier_shipments"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "courier_shipments_merchant_id_courier_tracking_number_key" ON "courier_shipments"("merchant_id", "courier", "tracking_number");

-- CreateIndex
CREATE INDEX "courier_events_merchant_id_idx" ON "courier_events"("merchant_id");

-- CreateIndex
CREATE INDEX "courier_events_shipment_id_idx" ON "courier_events"("shipment_id");

-- CreateIndex
CREATE INDEX "courier_events_shipment_id_occurred_at_idx" ON "courier_events"("shipment_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "courier_events_shipment_id_external_id_key" ON "courier_events"("shipment_id", "external_id");

-- CreateIndex
CREATE INDEX "outbound_webhooks_merchant_id_idx" ON "outbound_webhooks"("merchant_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_merchant_id_idx" ON "webhook_deliveries"("merchant_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_id_idx" ON "webhook_deliveries"("webhook_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_id_created_at_idx" ON "webhook_deliveries"("webhook_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_success_next_retry_at_idx" ON "webhook_deliveries"("success", "next_retry_at");

-- CreateIndex
CREATE INDEX "agency_assignments_agency_merchant_id_idx" ON "agency_assignments"("agency_merchant_id");

-- CreateIndex
CREATE INDEX "agency_assignments_user_id_idx" ON "agency_assignments"("user_id");

-- CreateIndex
CREATE INDEX "agency_assignments_child_merchant_id_idx" ON "agency_assignments"("child_merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_assignments_user_id_child_merchant_id_key" ON "agency_assignments"("user_id", "child_merchant_id");

-- CreateIndex
CREATE INDEX "merchant_integrations_merchant_id_idx" ON "merchant_integrations"("merchant_id");

-- CreateIndex
CREATE INDEX "merchant_integrations_provider_external_id_idx" ON "merchant_integrations"("provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_integrations_merchant_id_provider_key" ON "merchant_integrations"("merchant_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_integrations_provider_external_id_key" ON "merchant_integrations"("provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_settings_merchant_id_key" ON "merchant_settings"("merchant_id");

-- CreateIndex
CREATE INDEX "ai_generations_merchant_id_idx" ON "ai_generations"("merchant_id");

-- CreateIndex
CREATE INDEX "ai_generations_merchant_id_purpose_idx" ON "ai_generations"("merchant_id", "purpose");

-- CreateIndex
CREATE INDEX "messages_email_template_id_idx" ON "messages"("email_template_id");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_email_template_id_fkey" FOREIGN KEY ("email_template_id") REFERENCES "email_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sending_domains" ADD CONSTRAINT "sending_domains_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onsite_elements" ADD CONSTRAINT "onsite_elements_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onsite_elements" ADD CONSTRAINT "onsite_elements_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_cod_order_id_fkey" FOREIGN KEY ("cod_order_id") REFERENCES "cod_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_journey_enrollment_id_fkey" FOREIGN KEY ("journey_enrollment_id") REFERENCES "journey_enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_shipments" ADD CONSTRAINT "courier_shipments_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_shipments" ADD CONSTRAINT "courier_shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_shipments" ADD CONSTRAINT "courier_shipments_cod_order_id_fkey" FOREIGN KEY ("cod_order_id") REFERENCES "cod_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_shipments" ADD CONSTRAINT "courier_shipments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_events" ADD CONSTRAINT "courier_events_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_events" ADD CONSTRAINT "courier_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "courier_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_webhooks" ADD CONSTRAINT "outbound_webhooks_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "outbound_webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_assignments" ADD CONSTRAINT "agency_assignments_agency_merchant_id_fkey" FOREIGN KEY ("agency_merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_assignments" ADD CONSTRAINT "agency_assignments_child_merchant_id_fkey" FOREIGN KEY ("child_merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_assignments" ADD CONSTRAINT "agency_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_integrations" ADD CONSTRAINT "merchant_integrations_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_settings" ADD CONSTRAINT "merchant_settings_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- freeze-v2: partial UNIQUE — at most one OPEN WhatsApp conversation per (merchant, phone).
-- Prisma cannot express a partial-unique index in the schema, so it is hand-authored here (like the
-- customers_anon_ids_idx GIN index). Inbound-WhatsApp routing resolves THE open conversation for a
-- number deterministically; other-state rows (CLOSED/EXPIRED/AWAITING_REPLY) are unconstrained.
CREATE UNIQUE INDEX "whatsapp_conversations_open_phone_key" ON "whatsapp_conversations"("merchant_id", "phone") WHERE "state" = 'OPEN';
