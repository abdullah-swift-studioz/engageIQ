DROP INDEX IF EXISTS "journey_enrollments_journey_id_customer_id_key";
CREATE INDEX IF NOT EXISTS "journey_enrollments_journey_id_customer_id_status_idx" ON "journey_enrollments"("journey_id", "customer_id", "status");
