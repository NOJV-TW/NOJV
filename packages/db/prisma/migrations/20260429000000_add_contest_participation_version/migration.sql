-- Optimistic-lock counter for ContestParticipation. Concurrent Temporal
-- workflows that call `updateContestScores` for the same participation
-- previously raced on `prisma.contestParticipation.update(...)` — last
-- writer won and earlier writers' computations were silently lost.
--
-- The domain layer now does read-modify-write keyed on this column;
-- conflicts surface as P2025 from Prisma which the repo translates to
-- ConflictError so the caller can retry.

ALTER TABLE "ContestParticipation" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
