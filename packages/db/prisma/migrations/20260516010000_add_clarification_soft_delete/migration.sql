-- Clarification soft-delete. Lets staff (or the original asker) retract
-- a mistakenly-posted thread without hard-deleting accountability
-- history. All read paths filter `deletedAt IS NULL`; mirrors the
-- Editorial.deletedAt tombstone added in an earlier migration.
ALTER TABLE "Clarification" ADD COLUMN "deletedAt" TIMESTAMP(3);
