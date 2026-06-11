# Runbooks

Operational runbooks — step-by-step procedures for running, recovering, and
verifying NOJV. System design and invariants (not procedures) live under
`docs/architecture/` and `docs/operations/`; this page indexes the procedures
and links out to that reference material.

## Index

| Runbook                                       | When to use                                                       |
| --------------------------------------------- | ----------------------------------------------------------------- |
| [Getting Started](getting-started.md)         | First local run, environment setup, troubleshooting the dev stack |
| [Incident Recovery](incident-recovery.md)     | Outage response, SLO breach, recovery steps                       |
| [Backup & Restore](backup-restore.md)         | Backup posture, PITR, GCS / Redis snapshot restore                |
| [Observability Setup](observability-setup.md) | Setting up / updating Grafana metrics dashboards + alert rules    |
| [Testing Strategy](testing.md)                | Where new tests belong, how to run each layer                     |

## Reference Catalog

For design, invariants, and acceptance criteria (not procedures):

- **Architecture** — [System map](../architecture/ARCHITECTURE.md), [Frontend](../architecture/FRONTEND.md), [Judge pipeline](../architecture/JUDGE_PIPELINE.md), [Database](../architecture/DATABASE.md), [Redis](../architecture/REDIS.md), [Design rules](../architecture/DESIGN.md)
- **Operations** — [Deployment](../operations/DEPLOYMENT.md), [Reliability](../operations/RELIABILITY.md), [Security](../operations/SECURITY.md), [Threat model](../operations/THREAT_MODEL.md), [Quality ledger](../operations/QUALITY_SCORE.md)
- **Product** — [Product sense](../product/PRODUCT_SENSE.md), [Planning system](../product/PLANS.md)
- **Feature specs** — [`docs/specs/`](../specs/) (per-feature Given/When/Then acceptance criteria)

The repository's `AGENT.md` (symlinked as `CLAUDE.md`) is the canonical agent
entrypoint and carries the full reading order; `tests/unit/docs/doc-links.test.ts`
fails CI if any link in `AGENT.md` or this index goes dangling.
