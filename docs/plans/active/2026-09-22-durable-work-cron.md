# Preserve durable work recurrence across drains

The existing cron Workflow continues as new at the batch bound, and Temporal does
not carry its cron schedule into that execution. A later failure or completion
therefore stops durable dispatch. The TypeScript SDK's ContinueAsNew options do
not expose a cron schedule.

The paginated lifecycle reconciler has the same cron-plus-continuation risk.
Use small cron parents awaiting each existing draining child, the established
Temporal pattern for cron work that needs Continue-As-New. Preserve all Activity
limits, fairness cursors, leases, and database idempotency. No schema changes.

- [x] Keep the draining Workflow unchanged; add and register the cron parent.
- [x] Point the existing singleton ensure operation at each parent Workflow type.
- [x] Verify child continuation, failure, and completion across cron runs using
      the real Temporal test environment.
- [x] Run full local CI and independent review before committing.
- [ ] Release only after the former singleton is terminal; do not terminate its
      in-flight Activity to switch types.
