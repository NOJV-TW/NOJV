# `@nojv/sandbox-docker`

Hardened Docker argument and mount construction for worker-managed sandboxes
(JDG-19), including Advanced Mode service containers (`SANDBOX_RUN_USER`,
`buildAdvancedServiceArgs`, service port and readiness constants).

- Consumer: `apps/worker` only. Docker process lifecycle and Kubernetes
  execution belong to `apps/worker/src/sandbox/`; the contestant runtime is
  `apps/sandbox-runner`.
- No `@nojv/*` dependencies; no business rules or persisted contracts.
- Hardening requirements: [Security](../../docs/operations/SECURITY.md).
