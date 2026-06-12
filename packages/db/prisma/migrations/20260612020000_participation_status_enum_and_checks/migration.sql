-- CreateEnum
CREATE TYPE "ParticipationStatus" AS ENUM ('registered', 'active', 'submitted', 'disqualified');

-- AlterTable: replace the unbounded TEXT status (left behind when the three
-- legacy per-type enums were dropped in the supertype unification) with a
-- bounded enum. The supertype table started empty (no backfill), so the cast
-- touches no rows in a fresh build.
ALTER TABLE "Participation"
  ALTER COLUMN "status" TYPE "ParticipationStatus" USING "status"::"ParticipationStatus";

-- A virtual participation must carry its window. Without this, a row can exist
-- at the (type, contestId, userId) unique key with NULL startedAt/endsAt, which
-- makes findVirtual return NULL while createVirtual hits P2002 — a permanent
-- per-user deadlock on startVirtualContest. Prisma cannot express CHECKs, so
-- `migrate diff` is blind to this and it does not register as schema drift.
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_virtual_window_chk" CHECK (
    "type" <> 'virtual' OR ("startedAt" IS NOT NULL AND "endsAt" IS NOT NULL)
);

-- IP-proctoring columns are exam-only; contest/virtual rows must leave them NULL.
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_ip_exam_only_chk" CHECK (
    ("ipPin" IS NULL AND "ipGateExemptUntil" IS NULL) OR "type" = 'exam'
);
