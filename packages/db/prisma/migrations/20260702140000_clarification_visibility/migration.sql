-- Clarifications now carry an explicit visibility. Staff choose per answer
-- whether it is public (shown to every participant) or private (asker only);
-- pending questions are never shown to peers. Existing answered clarifications
-- were visible to everyone, so keep them public.
ALTER TABLE "Clarification" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Clarification" SET "isPublic" = true WHERE "state" = 'answered';
