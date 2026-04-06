# Security

Security requirements are first-class because this system handles authentication, student source code, hidden testcases, contest integrity, and grade-affecting assessment submissions.

## Sensitive Data

| Data | Storage | Protection |
| --- | --- | --- |
| Passwords | PostgreSQL `Account.password` | bcrypt hash |
| OAuth tokens | PostgreSQL `Account.accessToken` | Encrypted by better-auth |
| Session tokens | PostgreSQL `Session.token` | httpOnly cookie |
| Source code | PostgreSQL `Submission.sourceCode` | Per-user access control |
| Hidden testcases | PostgreSQL `Testcase` (isHidden=true) | Never exposed to students |
| Problem images | S3-compatible storage | Public read for problem paths |
| S3 credentials | Environment variables | .env untracked, Secret Manager in prod |
| Database credentials | Environment variables | .env untracked, Secret Manager in prod |

## Handling Rules

- Validate all user input with Zod schemas from `@nojv/core` before processing.
- Use `requireAuth(event)` for page routes and `requireApiAuth(event)` for API routes. Never skip authentication checks.
- Use `canEditProblem(platformRole)` for problem mutations. Use `isCourseStaff(role)` for course access.
- Effective course role = `max(platformRole, courseRole)` via `resolveEffectiveCourseRole()`. Admin overrides all.
- Use Prisma parameterized queries for all database access. Never construct SQL strings.
- Use DOMPurify for all user-authored markdown rendering. The sanitizer is configured in `$lib/markdown.ts`.
- Keep `.env` untracked and treat `.env.example` as a shape-only template without real values.
- If any secret appears in a committed file, rotate it immediately.
- Session cookies must be `httpOnly` and `Secure` in production.
- Rate-limit submission and plagiarism endpoints via Redis-backed `rate-limiter-flexible`.
- Image uploads must validate file type (png/jpeg/gif/webp), enforce 5MB size limit, and require `canEditProblem` permission.
- Sandbox containers must run with `cap-drop ALL`, `no-new-privileges`, read-only rootfs, `--network none`, and resource limits.
- Contest IP binding, page lock, and submit cooldown are server-side enforced. Never trust client-side checks alone.

## Input Validation

| Input | Schema | Limits |
| --- | --- | --- |
| Source code | `sourceCodeSchema` | 1–50,000 chars, trimmed |
| Slug | `slugSchema` | 3+ chars, `[a-z0-9-]+` |
| Problem statement | Markdown text | Per-field limits (statement 12k, input/output 4k) |
| Problem images | File upload | png/jpeg/gif/webp, 5MB max |
| Testcase input | Text | Stored as `@db.Text` |
| Editorial | `content` field | 10–50,000 chars |

## Review Expectations

Flag for security review when:
- Adding or modifying authentication or authorization logic
- Changing sandbox isolation configuration
- Adding new API routes that handle user input
- Modifying contest integrity features (IP binding, cooldown, page lock)
- Changing file upload or storage logic
- Adding new environment variables that contain secrets

## Related Docs

- [Threat Model](THREAT_MODEL.md)
- [Architecture Overview](../ARCHITECTURE.md)
- [Frontend Surface](FRONTEND.md)
- [Reliability Invariants](RELIABILITY.md)
