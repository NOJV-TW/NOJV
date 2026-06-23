-- Originally applied via db push before the proper backfill migration was created.
-- Column is now added by 20260610000000_add_attempt_reset_minute_of_day, and the table
-- has been renamed to "Assessment" by 20260610120000_rename_course_assessment_to_assessment,
-- so this is a no-op to avoid conflicts in shadow database replay.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'CourseAssessment'
      AND column_name  = 'attemptResetMinuteOfDay'
  ) THEN
    NULL; -- already applied
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'CourseAssessment'
  ) THEN
    ALTER TABLE "CourseAssessment" ADD COLUMN "attemptResetMinuteOfDay" INTEGER;
  END IF;
END $$;
