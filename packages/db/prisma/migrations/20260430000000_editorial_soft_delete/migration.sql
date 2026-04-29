-- Soft-delete tombstone for Editorial. Hard-deletes would lose history
-- and create races against the (userId, problemId, language) composite
-- key when an author re-publishes; instead, all read paths filter
-- `deletedAt IS NULL` and the domain layer rehydrates the same row when
-- a deleted author re-posts.

ALTER TABLE "Editorial" ADD COLUMN "deletedAt" TIMESTAMP(3);
