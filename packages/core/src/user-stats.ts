// The former `UserStats` denorm table (totalAc / totalAttempts /
// lastSubmittedAt) was deleted in the Phase 2 data-model cleanup —
// those three aggregates are now computed on-demand from the
// Submission table. Per-language and per-difficulty breakdowns are
// likewise computed on-demand, and daily activity lives in its own
// `UserDailyActivity` table (one row per user per calendar day).
//
// This file is kept as an empty module so the `@nojv/core` re-export
// barrel does not need to change in lockstep with downstream cleanup.
export {};
