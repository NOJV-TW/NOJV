// UserStats is a small hot-path denorm (totalAc, totalAttempts,
// lastSubmittedAt) — see packages/db/prisma/schema/submission.prisma.
// The legacy JSON blobs (languageDist, difficultyDist, dailyActivity)
// that used to live here have moved to first-class SQL: per-language
// and per-difficulty breakdowns are computed on-demand from the
// Submission table, and daily activity lives in its own
// UserDailyActivity table (one row per user per calendar day).
export {};
