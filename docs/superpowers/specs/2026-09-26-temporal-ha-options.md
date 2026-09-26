# Temporal HA options

**Status:** Proposal for owner decision, no implementation · **Date:** 2026-09-26 · **Touches:** OPS-09, DAT-13, JDG-12, OPS-11

## Current state

| Target         | Temporal server                                                                                                                | Persistence                                                                                                                                                         | Validated                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Single-machine | Official chart v1.4.x, one pod per role (`helm-values.single-machine.yaml`), manual Helm release in `nojv-temporal` (not Flux) | `temporal` + `temporal_visibility` on the app's CNPG cluster `nojv-pg` (one instance, local-path volume)                                                            | Running in production                                                                |
| GKE            | `helm-values.ha.yaml`: 2 pods per role, per-role PDB `minAvailable: 1`, pinned to `nojv-role: worker` (2 static nodes)         | `cloudsql-proxy.nojv-temporal.svc.cluster.local:5432`. **No manifest in the repo creates that Service**, and nothing requires the Cloud SQL instance to be regional | Rendered only ([HA-PRODUCTION.md](../../../infra/gcp/gke/temporal/HA-PRODUCTION.md)) |

All durable state is in Postgres, and the server roles are stateless. Workflows resume after any outage without data loss (DAT-13, JDG-10). The failure cost is **latency**: verdicts, contest and exam timers, reminders and the durable-work outbox stop advancing until Temporal is back. `POST /api/submissions` still returns 202.

## What actually limits availability

On single-machine, Temporal shares its fate with everything else:

| Failure                                                                                                                             | Web           | Temporal                                    | Does Temporal HA change the outcome?    |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------- | --------------------------------------- |
| Temporal pod crash or OOM (operator notes, 2026-09-22: history was OOMKilled at 512Mi; the live release now carries a 1Gi override) | Up            | That role is down until restart (≈ 10–60 s) | **Yes.** A second pod per role hides it |
| Temporal `helm upgrade`                                                                                                             | Up            | Brief pause per role                        | **Yes**, with 2 pods per role and PDBs  |
| CNPG instance restart (operator upgrade, OOM, eviction)                                                                             | Down (readyz) | Down                                        | No. The app is down anyway              |
| Node reboot, disk full, kernel or containerd fault                                                                                  | Down          | Down                                        | No                                      |
| Uplink or tunnel loss (the dominant cause in the 2026-09 availability audit)                                                        | Unreachable   | Keeps working                               | No                                      |

On GKE, a Temporal outage would be a partial failure: web stays up on Cloud SQL while judging stops. HA therefore protects more there, but only if the database is also HA.

## Options

### A. Single-machine: status quo plus hardening (recommended)

- Move the live overrides into the repo values file so a reinstall reproduces production: history resources (1Gi limit), dynamic config (fairness, new matcher, one partition per NOJV queue), and a pinned chart version. Today they exist only as `--reuse-values` state on the release. The `nodeSelector` instructions also disagree: `k8s-single-machine.md` sets `nojv-role=sandbox`, while `HA-PRODUCTION.md` sets `null`.
- Add a documented restart drill: delete each role's pod once with judging in flight, and record the time to recovery. The ledger item becomes evidence instead of an assumption.
- **Covers:** config drift and unknown recovery time. **Does not cover:** pod-level outage. **Cost:** none at runtime. **Complexity:** low.

### B. Single-machine: two pods per role on the one node

- `replicaCount: 2` per role (or only history and matching), `topologySpreadConstraints` not applicable, PDB optional because a single-node drain evicts everything anyway.
- **Covers:** pod crash, OOM of one pod, and Temporal chart upgrades without a pause.
- **Costs:**
  - Roughly +0.4 CPU and +1.3 GiB of requests at the current single-machine sizing, taken from the node budget that also feeds the sandbox quota (16 pods / 6 CPU / 16Gi on 8 vCPU / 16 GiB).
  - **Postgres connections:** each pod may open up to `maxConns` (10) per datastore, so 8 pods × 2 stores × 10 = 160. That is above CNPG's default `max_connections` of 100, before counting the app's Prisma pools. This option needs lower `maxConns` or an explicit `postgresql.parameters.max_connections` in the chart, which is a Postgres restart.
- **Complexity:** low to medium (values change, a connection budget, one extra load test).

### C. Single-machine: CNPG with 2–3 instances on the same node

- **Covers:** a Postgres process crash (fast replica promotion). **Does not cover:** node, disk or local-path volume loss, because every replica sits on the same disk.
- **Cost:** 2 GiB of memory per extra instance, plus disk and WAL replication I/O. **Complexity:** medium.
- Poor value on one host. It is listed so the owner can reject it explicitly.

### D. Multi-node k3s (true node-failure HA on self-hosted hardware)

- Needs 3 k3s servers with embedded etcd (a single server is itself a SPOF), CNPG with 3 instances spread by node, Temporal option B with anti-affinity, and in-cluster Redis, MinIO and cloudflared made redundant or accepted as SPOFs. Local-path volumes cannot move between nodes.
- **Covers:** single node loss. **Cost:** 2+ additional machines and the ops burden of etcd, storage and upgrades. **Complexity:** high. This is a platform project, not a Temporal change.

### E. GKE with the HA values

- **Prerequisites the repo lacks:**
  - A regional (HA) Cloud SQL instance for Temporal, which roughly doubles the instance price versus zonal. It may be the app's instance or a dedicated one.
  - A Cloud SQL Auth Proxy Deployment and Service in `nojv-temporal` with Workload Identity (the `connectAddr` target does not exist).
  - The dynamic config moved into the values file.
  - Validation on a real cluster: `temporal operator cluster health`, pod-kill and node-drain drills.
- **Covers:** pod, node and zone loss (with a regional database). **Complexity:** medium, plus Cloud SQL cost. Only relevant if GKE becomes a real production target.

### Out of scope

Temporal Cloud (rejected by OPS-09).

## Recommendation

1. **Single-machine: do A now and defer B.** Temporal HA cannot improve availability while web, Postgres and the node are single points of failure. The measured availability loss is network-side, not Temporal. Revisit B if the restart drill or production shows user-visible Temporal-only pauses, for example repeated history OOMs during exams.
2. **Reject C.**
3. **Treat D as a separate platform decision.** It is not justified by Temporal alone.
4. **GKE: do not claim HA until the E prerequisites exist.** Replace the Quality Ledger wording with the concrete gap list above when the owner confirms GKE is still a target.

## Decisions needed from the owner

1. What is the target RTO for "judging paused": minutes (A is enough) or seconds (B)? Is there an exam-time requirement that differs?
2. Is GKE a live production target? If not, should `helm-values.ha.yaml` and `HA-PRODUCTION.md` be marked as a reference that is not maintained?
3. Should the Temporal release move under Flux (a HelmRelease in `infra/flux/`) so its values are declarative, or stay a manual Helm release with values in the repo (option A)? Moving it touches OPS-02 and OPS-07 (Temporal's databases must not be prunable).
4. If B is chosen later, which connection-budget approach: lower Temporal `maxConns`, or raise CNPG `max_connections` (a chart change and a Postgres restart)?
5. For D or E: what budget is acceptable for extra machines or a regional Cloud SQL instance?
