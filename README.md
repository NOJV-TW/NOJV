<h1 align="center">NOJV</h1>

<p align="center">
  An open-source online judge for competitive programming and CS courses —
  contests, course assessments, exams, practice, and plagiarism detection.
</p>

<p align="center">
  <a href="https://nojv.tw"><b>nojv.tw</b></a>
</p>

<p align="center">
  <a href="https://github.com/TakalaWang/NOJV/actions/workflows/ci.yml"><img src="https://github.com/TakalaWang/NOJV/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-24.18--24.x-brightgreen" alt="Node 24.18 through 24.x">
  <img src="https://img.shields.io/badge/SvelteKit-%2BTemporal-ff3e00" alt="SvelteKit + Temporal">
</p>

## Features

- **8 languages**: C, C++, Go, Java, JavaScript, Python, Rust, TypeScript
- **Standard judging**: diff, DOMjudge-validator checkers and interactors, all-or-nothing subtasks
- **Advanced Mode**: teacher-built, digest-pinned run/grade images for problems Standard Mode cannot express
- **Contests**: ICPC/IOI scoring, live scoreboard, freeze, virtual contests
- **Courses and exams**: teacher-managed rosters, assignments with late policies, exams with session lock, IP rules and exam passwords
- **Plagiarism detection**: Dolos AST similarity, self-hosted
- **Durable judging**: Temporal workflows with immutable snapshots and bounded recovery
- **Sign-in**: GitHub and Google OAuth; no public password registration
- **i18n**: English and Traditional Chinese

## Quick start

Requires Node.js >=24.18 <25, pnpm 11.13.1 and Docker.

```bash
pnpm install
cp .env.example .env
docker compose up -d     # PostgreSQL, Redis, MinIO, Temporal (local development only)
pnpm db:generate && pnpm build && pnpm db:push && pnpm db:seed
pnpm sandbox:build
pnpm dev                 # http://localhost:5173
```

Details and troubleshooting: [Getting Started](docs/runbooks/getting-started.md).
Production deploys through the Helm chart in `infra/charts/nojv`: [Deployment Guide](docs/operations/DEPLOYMENT.md).

## Documentation

| Document                                              | Covers                                    |
| ----------------------------------------------------- | ----------------------------------------- |
| [AGENTS.md](AGENTS.md)                                | Entry point by task, repository layout    |
| [Documentation home](docs/README.md)                  | Task-to-code-and-test map                 |
| [Architecture](docs/architecture/ARCHITECTURE.md)     | System map and layer boundaries           |
| [Judge Pipeline](docs/architecture/JUDGE_PIPELINE.md) | Judging stages, sandboxing, recovery      |
| [Security](docs/operations/SECURITY.md)               | Auth, trust boundaries, sandbox isolation |
| [Reliability](docs/operations/RELIABILITY.md)         | SLOs, invariants, failure modes           |
| [Deployment](docs/operations/DEPLOYMENT.md)           | Helm chart, configuration, releases       |
| [Runbooks](docs/runbooks/README.md)                   | Operational procedures                    |
| [Decision log](docs/decisions/README.md)              | Why the system is shaped this way         |

## Contributing

1. Read [AGENTS.md](AGENTS.md).
2. Bring up a local stack with [Getting Started](docs/runbooks/getting-started.md).
3. Run `pnpm ci:verify` before pushing, and update the owning living doc in the same change.

## License

[MIT](LICENSE) © NOJV
