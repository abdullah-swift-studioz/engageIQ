-- Add anon_ids array to customers for SDK identity stitching
ALTER TABLE "customers" ADD COLUMN "anon_ids" TEXT[] NOT NULL DEFAULT '{}';

-- Index for reverse lookup: "which customer owns this anon_id?"
-- GIN index is required for array containment queries (@> operator).
CREATE INDEX "customers_anon_ids_idx" ON "customers" USING GIN ("anon_ids");
