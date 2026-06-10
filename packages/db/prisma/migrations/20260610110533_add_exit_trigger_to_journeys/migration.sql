-- DropIndex
DROP INDEX "customers_anon_ids_idx";

-- AlterTable
ALTER TABLE "journeys" ADD COLUMN     "exit_trigger" TEXT;
