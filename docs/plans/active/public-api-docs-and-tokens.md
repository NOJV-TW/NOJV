# Public API Docs And API Tokens

## Problem

NOJV needs a stable public API surface for external students and tools. Today, most /api/\*\* routes are internal SvelteKit web APIs designed for browser sessions, CSRF protection, and UI workflows. We should not treat every existing route as a public contract.

This project introduces two related capabilities:

1. Public API documentation, rendered as human-friendly docs and backed by an OpenAPI document.
2. API token authentication with scopes, expiry, rotation, revocation, and management UI.

## Goals

- Publish an OpenAPI document at `/api/openapi.json`.
- Render API documentation at `/api/docs`.
- Define a stable public API namespace, preferably `/api/v1/**`.
- Document only routes that are intended for external callers.
- Support Bearer token authentication for external clients.
- Allow users to create, manage, rotate, and revoke API tokens.
- Enforce token scopes per endpoint.
- Store token secrets securely: show plaintext once, store only hashes.
- Keep existing browser-session APIs working as they do today.

## Non-Goals

- Do not expose every existing /api/\*\* route as public API.
- Do not replace better-auth session authentication.
- Do not remove existing CSRF protection for browser-based internal APIs.
- Do not store raw API token secrets in the database.
- Do not promise long-term compatibility for internal web APIs.

## Existing Context

Relevant docs:

- [Frontend Surface](../../architecture/FRONTEND.md)
- [Security Requirements](../../operations/SECURITY.md)
- [Database Schema](../../architecture/DATABASE.md)
- [Planning System](../../product/PLANS.md)

Current state:

- SvelteKit route handlers live under `apps/web/src/routes/api/**`.
- Most API routes use `requireApiAuth(event)`, which reads `event.locals.sessionUser`.
- hooks.server.ts enforces CSRF-style protection for non-GET /api/\*\* requests using `X-Requested-With: fetch`.
- Auth is powered by better-auth sessions.
- There is currently no API token table.

## Proposed Public API Structure

Use `/api/v1/**` for external API clients.

Example first public endpoints:

| Endpoint                        | Method | Scope             | Purpose                            |
| ------------------------------- | ------ | ----------------- | ---------------------------------- |
| /api/v1/healthz                 | GET    | none              | Public health check                |
| /api/v1/problems                | GET    | problems:read     | List public problems               |
| /api/v1/problems/{id}           | GET    | problems:read     | Get problem detail                 |
| /api/v1/submissions             | POST   | submissions:write | Create a submission                |
| /api/v1/submissions/{id}        | GET    | submissions:read  | Get submission result              |
| /api/v1/submissions/{id}/source | GET    | submissions:read  | Get submission source if permitted |

Existing internal routes like `/api/submissions` may continue to exist for the web app, but public docs should prefer `/api/v1/submissions`.

## API Docs Safety Decisions

- Disable Scalar Ask AI / model-assisted features for public docs.
- Public API docs must not send student input, source code, tokens, or API metadata to third-party AI services.
- Keep interactive request execution disabled until `/api/v1/**` Bearer token authentication is implemented.
- Existing session-based `/api/**` routes remain internal candidates unless explicitly documented as public contract.

## API Documentation Design

Add:

```text
apps/web/src/lib/server/openapi/document.ts
apps/web/src/routes/api/openapi.json/+server.ts
apps/web/src/routes/api/docs/+server.ts
```

Routes:

```text
GET /api/openapi.json
GET /api/docs
Recommended tooling:
```

Scalar for rendered docs.
OpenAPI 3.1 as the document format.
Optional later: generate schemas from Zod using @asteasolutions/zod-to-openapi.
Initial implementation should hand-write a small OpenAPI document first. Once the docs pipeline is working, move shared schemas toward Zod-derived OpenAPI schemas.

## OpenAPI Security Scheme

The OpenAPI document should include a placeholder before token auth ships:

```yaml
components:
  securitySchemes:
    ApiToken:
      type: http
      scheme: bearer
      bearerFormat: NOJV API token
```

Token-authenticated endpoints should use:

```yaml
security:
  - ApiToken: []
```

Endpoint descriptions should explicitly state required scopes.

## API Token Model

Add a new Prisma model:

```prisma
enum ApiTokenStatus {
  active
  revoked
}
```

```
model ApiToken {
  id          String         @id @default(cuid())
  userId      String
  user        User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  name        String
  prefix      String         @unique
  tokenHash   String         @unique
  scopes      String[]

  status      ApiTokenStatus @default(active)
  expiresAt   DateTime?
  lastUsedAt  DateTime?
  lastUsedIp  String?

  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt
  revokedAt   DateTime?
  revokedById String?

  @@index([userId])
  @@index([status])
  @@index([expiresAt])
}
```

Add relation to User:

```
apiTokens ApiToken[]
```

## Token Format

Use an opaque token format:
`nojv_live_<prefix>.<secret>`
Example:
`nojv_live_8F3K2M9Q.nZb6...`
The plaintext token is shown only once after creation or rotation.

Store:

- prefix: short lookup prefix
- tokenHash: HMAC or strong hash of the full token
- never store the raw token

Verification flow:

1. Read `Authorization: Bearer <token>`.
2. Parse prefix.
3. Look up token row by prefix.
4. Hash the presented token.
5. Constant-time compare with `tokenHash`.
6. Reject if revoked.
7. Reject if expired.
8. Reject if owning user is disabled or incomplete.
9. Reject if required scope is missing.
10. Update lastUsedAt and `lastUsedIp`.

Initial Scopes
Start with a small stable set:

```ts
"profile:read";
"problems:read";
"submissions:read";
"submissions:write";
"contests:read";
"assignments:read";
```

Future staff/admin scopes:

```ts
"problems:write";
"courses:read";
"courses:write";
"rejudge:write";
"admin:read";
"admin:write";
```

Auth Integration
Keep existing `requireApiAuth(event)` for browser-session APIs.

Add a new token-aware auth helper for public APIs:
ts
requirePublicApiAuth(event, requiredScope)
It should return the same actor shape as existing auth where possible, so existing domain permission logic can be reused.

Public `/api/v1/**` routes should call the new helper.

Internal `/api/**` routes should continue using the current session-based helpers unless intentionally migrated.

## CSRF Boundary

Existing CSRF-style protection should remain for browser-session APIs.

For `/api/v1/**`, Bearer token auth should be used instead of requiring X-Requested-With: fetch.

hooks.server.ts should eventually distinguish:

```text
/api/v1/**      external token API
/api/**         internal browser/session API
```

Only internal mutation routes should require the current CSRF header.

## Token Management UI

Add user-facing management under:
text
/account/api-tokens
Required actions:

- Create token
- List tokens
- Update token name
- Update scopes
- Update expiry
- Rotate token
- Revoke token

List view should show:

- name
- prefix
- scopes
- status
- createdAt
- expiresAt
- lastUsedAt
- lastUsedIp

The plaintext token should be shown only immediately after create or rotate.

## Token Management API

Possible internal routes:

```
GET    /api/account/api-tokens
POST   /api/account/api-tokens
PATCH  /api/account/api-tokens/{id}
POST   /api/account/api-tokens/{id}/rotate
POST   /api/account/api-tokens/{id}/revoke
```

Hard delete is optional. Prefer revoke-first behavior so there is an audit trail.

## Milestones

### Milestone 1: API Docs Skeleton

- Add OpenAPI document module.
- Add `/api/openapi.json`.
- Add `/api/docs`.
- Document `/api/healthz` or `/api/v1/healthz`.
- Verify docs render locally.

### Milestone 2: Public API v1 Shape

- Decide first public endpoints.
- Add `/api/v1/**` route skeletons.
- Keep behavior aligned with existing domain layer.
- Document request and response schemas.

### Milestone 3: Token Data Model

- Add ApiToken Prisma model.
- Add repository functions.
- Add migration.
- Add token hashing/generation helper.

### Milestone 4: Token Auth Middleware

- Implement Bearer token parsing.
- Verify hash and expiry.
- Enforce scopes.
- Return actor context.
- Add tests for invalid, expired, revoked, and insufficient-scope tokens.

### Milestone 5: Token Management UI

- Add /account/api-tokens.
- Create/list/update/rotate/revoke tokens.
- Show token plaintext only once.

### Milestone 6: OpenAPI Auth Completion

- Add Bearer auth to OpenAPI.
- Document required scopes per endpoint.
- Add examples for curl / JavaScript / Python.

## Testing Plan

API docs:

- /api/openapi.json returns valid JSON.
- /api/docs renders without crashing.
- OpenAPI document contains expected paths and security schemes.

Token auth:

- Valid token can call scoped endpoint.
- Missing token returns 401.
- Invalid token returns 401.
- Expired token returns 401.
- Revoked token returns 401.
- Token without required scope returns 403.
- Disabled user token is rejected.
- lastUsedAt updates after successful use.

Regression:

- Existing session-based APIs still work.
- Existing CSRF checks still protect internal mutation APIs.
- Browser app behavior does not change.

## Open Questions

- Should all completed student accounts be allowed to create tokens?
- Should teachers/admins be able to disable token creation globally?
- What should the default expiry be: 30 days, 90 days, or no expiry?
- Should tokens be course-scoped in addition to general scopes?
- Should public API rate limits be per token, per IP, or both?
