# Security Requirements

## Trust Boundaries

```
Untrusted          │  Trusted
                   │
Browser ──────────►│──► SvelteKit Server ──► PostgreSQL
                   │         │
Student Code ─────►│──► Sandbox Container    Redis
                   │         │               Temporal
                   │    Docker / K8s
```

1. **Browser → Server**: All user input is untrusted. Validate with Zod schemas.
2. **Student Code → Sandbox**: Arbitrary code runs in isolated containers. Never trust sandbox output.
3. **Server → Database**: Prisma parameterized queries prevent SQL injection.
4. **Server → Redis**: Internal network only. No authentication in development.

## Authentication

### Providers

- **Email/password**: bcrypt-hashed passwords via better-auth
- **GitHub OAuth**: OAuth 2.0 authorization code flow
- **Google OAuth**: OAuth 2.0 authorization code flow

### Session Management

- Token-based sessions stored in PostgreSQL `Session` table
- IP address and user-agent tracked per session
- Session expiry enforced server-side
- Cookie-based token transport (httpOnly, secure in production)

### Profile Completion

After first login, users must complete their profile (username, email verification) before accessing content. Enforced at the `(app)` layout level.

## Authorization

### Platform Roles

| Role    | Access                                                             |
| ------- | ------------------------------------------------------------------ |
| admin   | Full system access, user management, all course/contest management |
| teacher | Create courses, contests, problems; manage own content             |
| student | Submit solutions, join courses/contests, view public content       |

### Course Roles

| Role    | Access                                                     |
| ------- | ---------------------------------------------------------- |
| teacher | Full course management, grade export, plagiarism detection |
| ta      | Member management, progress viewing                        |
| student | Submit assignments, view course content                    |

### Effective Role Resolution

`effectiveRole = max(platformRole, courseRole)`. Admin platform role overrides any course role. Checked via `resolveEffectiveCourseRole()`.

### Route Protection

- **Page routes**: `requireAuth(event)` in `+page.server.ts` or layout
- **API routes**: `requireApiAuth(event)` returns actor or throws 401
- **Role gates**: `requirePlatformRole(actor, ...roles)` throws 403
- **Course access**: `isCourseStaff(role)` checks teacher/ta membership

## Sandbox Isolation

Student code is the highest-risk input. Sandbox containers enforce:

| Control      | Setting                             |
| ------------ | ----------------------------------- |
| Capabilities | `cap-drop ALL`                      |
| Privileges   | `no-new-privileges`                 |
| Filesystem   | Read-only rootfs, `tmpfs /tmp` only |
| Network      | `--network none` (default)          |
| Resources    | CPU limit, memory limit, PID limit  |
| Seccomp      | Restricted system call profile      |

### Network Access (Optional)

Some problems require network access. When enabled:

- Firewall rules whitelist specific hosts/ports
- Traffic is logged for audit
- Sidecar services run in separate containers

## Contest Security

### IP Binding

When `ipBindingEnabled`:

1. First request from a participant records their IP (`boundIp`)
2. Subsequent requests from different IPs are rejected or logged
3. Violation mode: `block` (reject) or `notify` (log warning)

### IP Whitelist

When `ipWhitelistEnabled`:

- Only requests from whitelisted IPs are accepted
- Violations logged in `IpViolationLog` table

### Page Lock

When `pageLockEnabled`:

- Browser-side check prevents opening new tabs during contest
- Enforced via JavaScript visibility API

### Submit Cooldown

Cross-instance rate limiting via Redis `SET NX EX`:

- Prevents rapid-fire submissions during contests
- Configurable per-contest (`submitCooldownSec`)

## Data Protection

### Sensitive Data

| Data             | Storage                               | Protection                 |
| ---------------- | ------------------------------------- | -------------------------- |
| Passwords        | PostgreSQL `Account.password`         | bcrypt hash                |
| OAuth tokens     | PostgreSQL `Account.accessToken`      | Encrypted by better-auth   |
| Session tokens   | PostgreSQL `Session.token`            | httpOnly cookie            |
| Source code      | PostgreSQL `Submission.sourceCode`    | Access-controlled per user |
| Hidden testcases | PostgreSQL `Testcase` (isHidden=true) | Never exposed to students  |

### Access Control on Submissions

- Users can only view their own submissions (unless admin)
- Source code endpoint checks ownership
- SSE streaming validates submission ownership
- Contest submissions visible only to participant

## Input Validation

All user input validated with Zod 4 schemas from `@nojv/core`:

| Input             | Schema             | Limits                    |
| ----------------- | ------------------ | ------------------------- |
| Source code       | `sourceCodeSchema` | 1 - 50,000 chars, trimmed |
| Slug              | `slugSchema`       | 3+ chars, `[a-z0-9-]+`    |
| Problem statement | Markdown text      | Per-field limits          |
| Testcase input    | Text               | Stored as `@db.Text`      |
| Editorial         | `content` field    | 10 - 50,000 chars         |

## API Rate Limiting

- Redis-backed via `rate-limiter-flexible`
- Applied to submission and plagiarism endpoints
- Per-user, cross-instance consistent
- Key pattern: `nojv:rl:{endpoint}:{userId}`

## Related Docs

- [Architecture Overview](../ARCHITECTURE.md)
- [Frontend Surface](FRONTEND.md)
- [Judge Pipeline](JUDGE_PIPELINE.md)
- [Reliability Invariants](RELIABILITY.md)
