# Runbooks

Procedures for running, recovering and verifying NOJV: numbered steps, exact
commands and how to verify. Invariants and failure behavior live in
[Reliability](../operations/RELIABILITY.md); configuration reference lives in
[Deployment](../operations/DEPLOYMENT.md).

| Runbook                                       | Use when                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Getting Started](getting-started.md)         | First local run, dev stack troubleshooting                                         |
| [Testing Strategy](testing.md)                | Choosing a test layer, running suites, test databases, judge benchmark             |
| [Single-Machine k3s](k8s-single-machine.md)   | Installing or scaling the one-node production cluster                              |
| [Incident Recovery](incident-recovery.md)     | Outage, SLO breach, stalled release, disk pressure                                 |
| [Judge Queue](judge-queue.md)                 | Priority/fairness, slot and quota sizing, parking bulk rejudges, lease cleanup     |
| [Backup & Restore](backup-restore.md)         | Enabling backups, PITR, object storage restore, restore drills                     |
| [Observability Setup](observability-setup.md) | Metrics export, dashboards, alert rules, judge recovery monitoring, token rotation |

Reference material: [architecture](../architecture/ARCHITECTURE.md),
[judge pipeline](../architecture/JUDGE_PIPELINE.md),
[security](../operations/SECURITY.md), [decision log](../decisions/README.md),
[feature specs](../features/).
