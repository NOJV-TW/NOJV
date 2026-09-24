# Applications

Applications are runnable processes; shared business rules belong in
`packages/application`, contracts in `packages/core`, and persistence in
`packages/db`.

| App               | Responsibility                                                                               | Local guide                                |
| ----------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `web/`            | SvelteKit pages, HTTP/API presentation, authentication wiring                                | [Web README](web/README.md)                |
| `worker/`         | Temporal worker bootstrap, workflows, activities and Docker/Kubernetes sandbox orchestration | [Worker README](worker/README.md)          |
| `sandbox-runner/` | Untrusted program execution in the isolated container                                        | [Sandbox README](sandbox-runner/README.md) |

Read [Architecture](../docs/architecture/ARCHITECTURE.md) for allowed imports
and runtime boundaries. Read each app guide for its entry point and commands.
