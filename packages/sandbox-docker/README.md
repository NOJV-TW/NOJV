# `@nojv/sandbox-docker`

Shared, hardened Docker command and mount construction for worker-managed
submission sandboxes. Docker process lifecycle and Kubernetes execution belong
to `apps/worker`; the isolated contestant runtime belongs to
`apps/sandbox-runner`.

This package has no internal workspace dependencies. The worker and sandbox
applications consume it as an infrastructure helper; do not put business rules
or persisted contracts here.
