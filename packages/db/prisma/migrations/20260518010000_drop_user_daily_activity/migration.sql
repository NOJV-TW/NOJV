-- UserDailyActivity was a pre-aggregated per-(user, UTC-day) table for
-- the dashboard heatmap / streak. The dashboard now derives those
-- client-side from raw Submission rows in the viewer's local timezone,
-- so the table has no remaining readers.

-- DropTable
DROP TABLE "UserDailyActivity";
