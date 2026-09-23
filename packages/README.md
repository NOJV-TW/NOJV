# Shared packages

Packages have one owner per shared capability. Their runtime dependency rules
are documented in [Architecture](../docs/architecture/ARCHITECTURE.md) and
enforced by workspace configuration and lint rules.

| Package          | Responsibility                                                          |
| ---------------- | ----------------------------------------------------------------------- |
| `core`           | Shared validation schemas, types, constants and pure domain helpers     |
| `application`    | Product operations, authorization and transaction orchestration         |
| `db`             | Prisma schema, applied migrations and repositories                      |
| `redis`          | Redis connections, key registry and pub/sub                             |
| `storage`        | S3-compatible client, key definitions and object operations             |
| `temporal`       | Temporal connection, dispatch/query API, task queues and workflow types |
| `mailer`         | SMTP and development/test sink                                          |
| `sandbox-docker` | Shared hardened Docker configuration                                    |

Each package README documents its public entry, dependencies and local
commands. Do not add a cross-package abstraction before a second real owner
needs it.
