-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('STARTER', 'GROWTH', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MARKETER', 'ANALYST', 'AGENCY_ADMIN', 'AGENCY_MEMBER');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JourneyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "JourneyStepType" AS ENUM ('TRIGGER', 'ACTION', 'CONDITION', 'DELAY', 'AB_SPLIT');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXITED', 'FAILED');

-- CreateEnum
CREATE TYPE "CodOrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CodVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING_VERIFICATION', 'VERIFIED', 'AUTO_CANCELLED');

-- CreateEnum
CREATE TYPE "RfmSegment" AS ENUM ('CHAMPION', 'LOYAL', 'POTENTIAL_LOYALIST', 'NEW_CUSTOMER', 'PROMISING', 'NEED_ATTENTION', 'ABOUT_TO_SLEEP', 'AT_RISK', 'CANNOT_LOSE_THEM', 'HIBERNATING', 'LOST');

-- CreateEnum
CREATE TYPE "ChurnRiskLabel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ReEntryRule" AS ENUM ('ALLOW', 'DISALLOW', 'RE_ENROLL_AFTER_EXIT');

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shopify_domain" TEXT,
    "shopify_access_token" TEXT,
    "shopify_shop_id" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'STARTER',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "backfill_completed_at" TIMESTAMP(3),
    "agency_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MARKETER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "shopify_customer_id" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "city" TEXT,
    "province" TEXT,
    "country" TEXT NOT NULL DEFAULT 'PK',
    "language_preference" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "total_spent" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "avg_order_value" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "first_order_at" TIMESTAMP(3),
    "last_order_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "session_count" INTEGER NOT NULL DEFAULT 0,
    "rfm_segment" "RfmSegment",
    "rfm_recency_score" INTEGER,
    "rfm_frequency_score" INTEGER,
    "rfm_monetary_score" INTEGER,
    "rfm_scored_at" TIMESTAMP(3),
    "churn_score" DOUBLE PRECISION,
    "churn_risk_label" "ChurnRiskLabel",
    "churn_scored_at" TIMESTAMP(3),
    "ltv_90d" DECIMAL(12,2),
    "ltv_180d" DECIMAL(12,2),
    "ltv_365d" DECIMAL(12,2),
    "ltv_scored_at" TIMESTAMP(3),
    "cod_order_count" INTEGER NOT NULL DEFAULT 0,
    "cod_acceptance_rate" DOUBLE PRECISION,
    "cod_rejection_rate" DOUBLE PRECISION,
    "fake_order_score" DOUBLE PRECISION,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "is_subscribed_email" BOOLEAN NOT NULL DEFAULT true,
    "is_subscribed_sms" BOOLEAN NOT NULL DEFAULT true,
    "is_subscribed_whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "group_customer_id" TEXT,
    "merged_into_id" TEXT,
    "merged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "conditions" JSONB NOT NULL,
    "is_dynamic" BOOLEAN NOT NULL DEFAULT true,
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "last_evaluated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_memberships" (
    "id" TEXT NOT NULL,
    "segment_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exited_at" TIMESTAMP(3),

    CONSTRAINT "segment_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "segment_id" TEXT,
    "subject" TEXT,
    "content" JSONB NOT NULL,
    "send_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "delivered_count" INTEGER NOT NULL DEFAULT 0,
    "opened_count" INTEGER NOT NULL DEFAULT 0,
    "clicked_count" INTEGER NOT NULL DEFAULT 0,
    "unsubscribed_count" INTEGER NOT NULL DEFAULT 0,
    "revenue_attributed" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "utm_campaign" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journeys" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger_type" TEXT NOT NULL,
    "trigger_config" JSONB NOT NULL,
    "status" "JourneyStatus" NOT NULL DEFAULT 'DRAFT',
    "re_entry_rule" "ReEntryRule" NOT NULL DEFAULT 'DISALLOW',
    "enrollment_count" INTEGER NOT NULL DEFAULT 0,
    "completion_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_steps" (
    "id" TEXT NOT NULL,
    "journey_id" TEXT NOT NULL,
    "parent_step_id" TEXT,
    "step_type" "JourneyStepType" NOT NULL,
    "config" JSONB NOT NULL,
    "position_x" INTEGER NOT NULL DEFAULT 0,
    "position_y" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_enrollments" (
    "id" TEXT NOT NULL,
    "journey_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "current_step_id" TEXT,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "exited_at" TIMESTAMP(3),
    "last_step_at" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "journey_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cod_orders" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "shopify_order_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "city" TEXT,
    "province" TEXT,
    "courier" TEXT,
    "payment_gateway" TEXT NOT NULL,
    "status" "CodOrderStatus" NOT NULL DEFAULT 'PENDING',
    "verification_status" "CodVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "fake_score" DOUBLE PRECISION,
    "fake_score_details" JSONB,
    "verification_sent_at" TIMESTAMP(3),
    "verification_replied_at" TIMESTAMP(3),
    "placed_at" TIMESTAMP(3) NOT NULL,
    "delivered_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cod_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchants_shopify_domain_key" ON "merchants"("shopify_domain");

-- CreateIndex
CREATE INDEX "users_merchant_id_idx" ON "users"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_merchant_id_email_key" ON "users"("merchant_id", "email");

-- CreateIndex
CREATE INDEX "customers_merchant_id_idx" ON "customers"("merchant_id");

-- CreateIndex
CREATE INDEX "customers_merchant_id_rfm_segment_idx" ON "customers"("merchant_id", "rfm_segment");

-- CreateIndex
CREATE INDEX "customers_merchant_id_churn_risk_label_idx" ON "customers"("merchant_id", "churn_risk_label");

-- CreateIndex
CREATE INDEX "customers_group_customer_id_idx" ON "customers"("group_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_merchant_id_shopify_customer_id_key" ON "customers"("merchant_id", "shopify_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_merchant_id_email_key" ON "customers"("merchant_id", "email");

-- CreateIndex
CREATE INDEX "segments_merchant_id_idx" ON "segments"("merchant_id");

-- CreateIndex
CREATE INDEX "segment_memberships_customer_id_idx" ON "segment_memberships"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "segment_memberships_segment_id_customer_id_key" ON "segment_memberships"("segment_id", "customer_id");

-- CreateIndex
CREATE INDEX "campaigns_merchant_id_idx" ON "campaigns"("merchant_id");

-- CreateIndex
CREATE INDEX "campaigns_merchant_id_status_idx" ON "campaigns"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "journeys_merchant_id_idx" ON "journeys"("merchant_id");

-- CreateIndex
CREATE INDEX "journeys_merchant_id_status_idx" ON "journeys"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "journey_steps_journey_id_idx" ON "journey_steps"("journey_id");

-- CreateIndex
CREATE INDEX "journey_enrollments_customer_id_idx" ON "journey_enrollments"("customer_id");

-- CreateIndex
CREATE INDEX "journey_enrollments_journey_id_status_idx" ON "journey_enrollments"("journey_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "journey_enrollments_journey_id_customer_id_key" ON "journey_enrollments"("journey_id", "customer_id");

-- CreateIndex
CREATE INDEX "cod_orders_merchant_id_idx" ON "cod_orders"("merchant_id");

-- CreateIndex
CREATE INDEX "cod_orders_merchant_id_status_idx" ON "cod_orders"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "cod_orders_customer_id_idx" ON "cod_orders"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "cod_orders_merchant_id_shopify_order_id_key" ON "cod_orders"("merchant_id", "shopify_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_merchant_id_idx" ON "api_keys"("merchant_id");

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_steps" ADD CONSTRAINT "journey_steps_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_steps" ADD CONSTRAINT "journey_steps_parent_step_id_fkey" FOREIGN KEY ("parent_step_id") REFERENCES "journey_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_current_step_id_fkey" FOREIGN KEY ("current_step_id") REFERENCES "journey_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cod_orders" ADD CONSTRAINT "cod_orders_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cod_orders" ADD CONSTRAINT "cod_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
