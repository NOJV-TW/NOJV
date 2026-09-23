# Infrastructure

| Directory      | Responsibility                                                         | Guide                                                                        |
| -------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `charts/nojv/` | The single Helm deployment chart for GKE and single-machine Kubernetes | [Chart guide](charts/nojv/README.md)                                         |
| `docker/`      | Web, worker, migrator, sandbox and demo image definitions              | See each Dockerfile and [deployment guide](../docs/operations/DEPLOYMENT.md) |
| `gcp/`         | Cloud Build, GKE provisioning, release and backup helpers              | [GCP guide](gcp/README.md)                                                   |
| `flux/`        | GitOps release inputs and reconciliation                               | [Flux guide](flux/README.md)                                                 |
| `grafana/`     | Dashboard and alert definitions                                        | [Observability runbook](../docs/runbooks/observability-setup.md)             |
| `k3s/`, `k8s/` | Single-machine cluster bootstrap and cluster policy assets             | [Deployment guide](../docs/operations/DEPLOYMENT.md)                         |

The Helm umbrella chart is the application deploy path. Docker Compose is for
local development. See [Deployment](../docs/operations/DEPLOYMENT.md) before
changing rollout or secret behavior.
