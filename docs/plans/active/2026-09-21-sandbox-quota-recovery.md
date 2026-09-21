# Judge recovery rollout

Implementation: [PR #471](https://github.com/NOJV-TW/NOJV/pull/471).
Keep this plan active until production acceptance is complete. Investigation logs,
incident inventories, intermediate test results, and review history belong in the PR
or restricted operational evidence, not this repository.

The durable contract is maintained in [Judge Pipeline](../../architecture/JUDGE_PIPELINE.md#durable-execution-and-recovery)
and [Reliability Invariants](../../operations/RELIABILITY.md). Recovery procedures
are in [Incident Recovery](../../runbooks/incident-recovery.md); metric and alert
verification is in [Observability Setup](../../runbooks/observability-setup.md).

## Production acceptance

- [ ] Verify the deployed migration, worker image digest, and source revision.
- [ ] Verify automatic recovery on the original snapshot after capacity returns
      and after a worker restart; verify stage progress and resource cleanup.
- [ ] Observe representative traffic for at least 15 minutes: no new
      capacity-related SE, queue drains, and recovery metrics remain fresh.
- [ ] Verify the alert datasource and delivery independently of worker readiness.
- [ ] Confirm historical submissions without a snapshot remain explicitly blocked.
      Only a teacher's explicit rejudge may select the latest version; verify its
      new verdict, audit entry, and score updates separately.

Move this plan to `completed/` after these acceptance checks pass.
