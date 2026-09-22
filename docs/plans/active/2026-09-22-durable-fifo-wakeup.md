# Durable FIFO wakeups

Replace per-execution 30-second FIFO polling with durable registrations in the existing admission coordinator. Database ordering and workflow ownership remain the authority; a wake signal only asks the execution to check again. Admission permits, sandbox cleanup, accepted snapshots and scoring remain unchanged.

The coordinator coalesces registration/retirement/routing events into one batch eligibility read. Its existing 30-second reconciliation also checks registered waiters so database-only cancellation, legacy completion and missed finalization signals cannot strand them. Replies are retained until Temporal records delivery; request identity and a monotonically increasing check sequence make duplicates and stale notifications harmless. Cancelled/obsolete registrations are retired without treating a lease as released.

Existing histories must replay their old timers and switch at a future FIFO loop boundary. Validate the inside-loop patch against an old multi-iteration history, a live transition and cold replay before enabling this branch. Coordinator state additions default safely during replay and survive continue-as-new.

Unclaimed first-permit waits also use durable replies without a timer, behind a separate inside-loop patch. Claimed attempts retain their existing 30-second ownership heartbeats and cleanup contract.

A registered FIFO waiter also re-checks its turn after a 30-minute fallback so a lost or rejected registration, or a reset coordinator, can never strand an accepted execution; the fallback re-registers with a higher check sequence and costs at most one turn per waiter per half hour.

Validation is bounded regression, not a load test: database FIFO/ownership cases; duplicate registration, signal-before-condition, cancellation/recovery/rollback routing, coordinator restart; and history replay. Do not run production commands or create synthetic throughput workloads for this change.

## Progress

- [x] Inspect current FIFO, dispatch, cancellation and recovery boundaries.
- [x] Verify inside-loop patch transition and replay.
- [x] Implement coordinator registrations, batched read and execution wakeup.
- [x] Run bounded regressions and local CI.
- [x] Independent review and publish a reviewable change.
