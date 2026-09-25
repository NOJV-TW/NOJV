# Infrastructure

The Helm chart is the only deploy path (OPS-01); Docker Compose is for local
development. Read the [Deployment Guide](../docs/operations/DEPLOYMENT.md) before
changing rollout, release or secret behavior.

| Directory      | Contents                                                                                                | Guide                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `charts/nojv/` | Helm chart and the single-machine and GKE overlays                                                      | [Chart guide](charts/nojv/README.md)                             |
| `docker/`      | Web, worker, migrator and sandbox Dockerfiles; demo special_env images; compose Temporal dynamic config | [Deployment guide](../docs/operations/DEPLOYMENT.md#images)      |
| `flux/`        | Single-machine GitOps release                                                                           | [Flux guide](flux/README.md)                                     |
| `gcp/`         | Cloud Build deploy, GKE node pools, Temporal values, Cloud SQL backups, Cloudflare CIDRs                | [GCP guide](gcp/README.md)                                       |
| `grafana/`     | Dashboards, alert rules and the provisioning script                                                     | [Observability runbook](../docs/runbooks/observability-setup.md) |
| `k3s/`         | containerd `runsc` template, `gvisor` RuntimeClass, kubelet drop-ins                                    | [Single-machine runbook](../docs/runbooks/k8s-single-machine.md) |
| `k8s/vendor/`  | Vendored, digest-pinned Calico manifest used by the nightly sandbox workflow                            | [Testing Strategy](../docs/runbooks/testing.md)                  |

Verify infra changes with `pnpm lint:helm` and
`pnpm exec vitest run --project unit tests/unit/infra/`.
