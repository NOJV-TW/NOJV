-- `ActiveExamSession.ipPin` was written at session start but never read
-- by enforcement code — `checkIpLock` has always consulted
-- `ExamParticipation.ipPin` as the authoritative pin. Dropping the
-- unused column collapses the two sources of truth into one.
ALTER TABLE "ActiveExamSession" DROP COLUMN "ipPin";
