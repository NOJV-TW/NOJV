-- Phase 3 of the CUID unification introduced `ContestParticipation.ipPin` to
-- match `ExamParticipation.ipPin` and route both flows through the shared
-- proctoring helper. The legacy `boundIp` / `boundIpClearedAt` columns were
-- left in place as a transitional step but no caller reads or writes them
-- anymore (verified: grep for `boundIp` in src/ finds zero reads). Drop them.

ALTER TABLE "ContestParticipation" DROP COLUMN "boundIp";
ALTER TABLE "ContestParticipation" DROP COLUMN "boundIpClearedAt";
