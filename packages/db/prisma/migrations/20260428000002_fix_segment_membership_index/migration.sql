DROP INDEX IF EXISTS "segment_memberships_segment_id_customer_id_key";
CREATE INDEX IF NOT EXISTS "segment_memberships_segment_id_customer_id_idx" ON "segment_memberships"("segment_id", "customer_id");
CREATE INDEX IF NOT EXISTS "segment_memberships_segment_id_customer_id_exited_at_idx" ON "segment_memberships"("segment_id", "customer_id", "exited_at");
