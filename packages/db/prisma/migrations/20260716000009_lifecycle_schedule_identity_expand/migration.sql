ALTER TABLE "Exam"
  ADD COLUMN "scheduleRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "timerFingerprint" TEXT;

ALTER TABLE "Contest"
  ADD COLUMN "scheduleRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "timerFingerprint" TEXT;

ALTER TABLE "Assessment"
  ADD COLUMN "scheduleRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "timerFingerprint" TEXT;

UPDATE "Exam"
SET
  "scheduleRevision" = CASE WHEN "status" = 'published' THEN 1 ELSE 0 END,
  "timerFingerprint" = concat(
    'exam:v1:', "id", ':',
    (extract(epoch FROM "createdAt") * 1000)::bigint, ':',
    (extract(epoch FROM "startsAt") * 1000)::bigint, ':',
    (extract(epoch FROM "endsAt") * 1000)::bigint
  );

UPDATE "Contest"
SET
  "scheduleRevision" = CASE WHEN "visibility" = 'published' THEN 1 ELSE 0 END,
  "timerFingerprint" = concat(
    'contest:v1:', "id", ':',
    (extract(epoch FROM "createdAt") * 1000)::bigint, ':',
    (extract(epoch FROM "startsAt") * 1000)::bigint, ':',
    (extract(epoch FROM "endsAt") * 1000)::bigint, ':',
    COALESCE((extract(epoch FROM "frozenAt") * 1000)::bigint::text, '-'), ':',
    "scoreboardMode"::text
  );

UPDATE "Assessment"
SET
  "scheduleRevision" = CASE WHEN "status" = 'published' THEN 1 ELSE 0 END,
  "timerFingerprint" = concat(
    'assessment:v1:', "id", ':',
    (extract(epoch FROM "createdAt") * 1000)::bigint, ':',
    (extract(epoch FROM "opensAt") * 1000)::bigint, ':',
    (extract(epoch FROM "closesAt") * 1000)::bigint
  );

CREATE OR REPLACE FUNCTION maintain_lifecycle_schedule_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  schedule_changed BOOLEAN;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'Exam' THEN
      schedule_changed := TG_OP = 'INSERT' OR (
        OLD."id" IS DISTINCT FROM NEW."id"
        OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
        OR OLD."status" IS DISTINCT FROM NEW."status"
        OR OLD."startsAt" IS DISTINCT FROM NEW."startsAt"
        OR OLD."endsAt" IS DISTINCT FROM NEW."endsAt"
      );
      NEW."timerFingerprint" := concat(
        'exam:v1:', NEW."id", ':',
        (extract(epoch FROM NEW."createdAt") * 1000)::bigint, ':',
        (extract(epoch FROM NEW."startsAt") * 1000)::bigint, ':',
        (extract(epoch FROM NEW."endsAt") * 1000)::bigint
      );
      IF TG_OP = 'INSERT' THEN
        NEW."scheduleRevision" := CASE WHEN NEW."status" = 'published' THEN 1 ELSE 0 END;
      END IF;

    WHEN 'Contest' THEN
      schedule_changed := TG_OP = 'INSERT' OR (
        OLD."id" IS DISTINCT FROM NEW."id"
        OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
        OR OLD."visibility" IS DISTINCT FROM NEW."visibility"
        OR OLD."startsAt" IS DISTINCT FROM NEW."startsAt"
        OR OLD."endsAt" IS DISTINCT FROM NEW."endsAt"
        OR OLD."frozenAt" IS DISTINCT FROM NEW."frozenAt"
        OR OLD."scoreboardMode" IS DISTINCT FROM NEW."scoreboardMode"
      );
      NEW."timerFingerprint" := concat(
        'contest:v1:', NEW."id", ':',
        (extract(epoch FROM NEW."createdAt") * 1000)::bigint, ':',
        (extract(epoch FROM NEW."startsAt") * 1000)::bigint, ':',
        (extract(epoch FROM NEW."endsAt") * 1000)::bigint, ':',
        COALESCE((extract(epoch FROM NEW."frozenAt") * 1000)::bigint::text, '-'), ':',
        NEW."scoreboardMode"::text
      );
      IF TG_OP = 'INSERT' THEN
        NEW."scheduleRevision" := CASE WHEN NEW."visibility" = 'published' THEN 1 ELSE 0 END;
      END IF;

    WHEN 'Assessment' THEN
      schedule_changed := TG_OP = 'INSERT' OR (
        OLD."id" IS DISTINCT FROM NEW."id"
        OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
        OR OLD."status" IS DISTINCT FROM NEW."status"
        OR OLD."opensAt" IS DISTINCT FROM NEW."opensAt"
        OR OLD."closesAt" IS DISTINCT FROM NEW."closesAt"
      );
      NEW."timerFingerprint" := concat(
        'assessment:v1:', NEW."id", ':',
        (extract(epoch FROM NEW."createdAt") * 1000)::bigint, ':',
        (extract(epoch FROM NEW."opensAt") * 1000)::bigint, ':',
        (extract(epoch FROM NEW."closesAt") * 1000)::bigint
      );
      IF TG_OP = 'INSERT' THEN
        NEW."scheduleRevision" := CASE WHEN NEW."status" = 'published' THEN 1 ELSE 0 END;
      END IF;

    ELSE
      RAISE EXCEPTION 'Unsupported lifecycle table: %', TG_TABLE_NAME;
  END CASE;

  IF TG_OP = 'UPDATE' THEN
    NEW."scheduleRevision" := CASE
      WHEN schedule_changed THEN OLD."scheduleRevision" + 1
      ELSE OLD."scheduleRevision"
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exam_lifecycle_schedule_identity ON "Exam";
CREATE TRIGGER exam_lifecycle_schedule_identity
BEFORE INSERT OR UPDATE ON "Exam"
FOR EACH ROW
EXECUTE FUNCTION maintain_lifecycle_schedule_identity();

DROP TRIGGER IF EXISTS contest_lifecycle_schedule_identity ON "Contest";
CREATE TRIGGER contest_lifecycle_schedule_identity
BEFORE INSERT OR UPDATE ON "Contest"
FOR EACH ROW
EXECUTE FUNCTION maintain_lifecycle_schedule_identity();

DROP TRIGGER IF EXISTS assessment_lifecycle_schedule_identity ON "Assessment";
CREATE TRIGGER assessment_lifecycle_schedule_identity
BEFORE INSERT OR UPDATE ON "Assessment"
FOR EACH ROW
EXECUTE FUNCTION maintain_lifecycle_schedule_identity();
