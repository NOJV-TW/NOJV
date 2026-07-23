ALTER TABLE "User"
  ADD COLUMN "studentTourSeenAt" TIMESTAMP(3),
  ADD COLUMN "teacherTourSeenAt" TIMESTAMP(3);

UPDATE "User"
SET "studentTourSeenAt" = CURRENT_TIMESTAMP
WHERE "platformRole" = 'student';

UPDATE "User"
SET "teacherTourSeenAt" = CURRENT_TIMESTAMP
WHERE "platformRole" = 'teacher';
