# Page Lock & IP Lock Design

Date: 2026-03-20

## Background

Contest and CourseAssessment models already have `pageLockEnabled` and `ipLockEnabled` boolean fields, but enforcement is minimal:

- **Page Lock**: Only a single navigation guard in `problems/[slug]/+page.server.ts` that redirects away from non-contest problems. No coverage for other routes.
- **IP Lock**: Database field only. Zero enforcement code.

## Goals

1. **Page Lock**: When enabled, restrict authenticated users to contest/assessment pages only (prevent accessing past submissions, other problems, etc.)
2. **IP Lock**: Two independent mechanisms — IP whitelist and IP first-binding — with configurable violation handling (block or notify)

---

## 1. Data Model Changes

### 1.1 Contest

```diff
  model Contest {
    ...
    pageLockEnabled     Boolean @default(false)
-   ipLockEnabled       Boolean @default(false)
+   ipWhitelistEnabled  Boolean @default(false)
+   ipBindingEnabled    Boolean @default(false)
+   ipWhitelist         String[]    // CIDR ranges, e.g. ["140.112.0.0/16"]
+   ipViolationMode     String @default("block")  // "block" | "notify"
    ...
  }
```

### 1.2 CourseAssessment

```diff
  model CourseAssessment {
    ...
    pageLockEnabled     Boolean @default(false)
-   ipLockEnabled       Boolean @default(false)
+   ipWhitelistEnabled  Boolean @default(false)
+   ipBindingEnabled    Boolean @default(false)
+   ipWhitelist         String[]
+   ipViolationMode     String @default("block")
    ...
  }
```

### 1.3 ContestParticipation (add fields)

```diff
  model ContestParticipation {
    ...
+   boundIp   String?
+   boundAt   DateTime?
    ...
  }
```

### 1.4 New: AssessmentParticipation

```prisma
model AssessmentParticipation {
  id              String           @id @default(cuid())
  userId          String
  user            User             @relation(fields: [userId], references: [id])
  assessmentId    String
  assessment      CourseAssessment @relation(fields: [assessmentId], references: [id])
  boundIp         String?
  boundAt         DateTime?
  createdAt       DateTime         @default(now())

  @@unique([userId, assessmentId])
}
```

### 1.5 New: IpViolationLog

Records IP violations when `ipViolationMode` is `"notify"`.

```prisma
model IpViolationLog {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  contestId       String?
  assessmentId    String?
  expectedIp      String?          // boundIp or whitelist info
  actualIp        String
  violationType   String           // "whitelist" | "binding"
  createdAt       DateTime @default(now())
}
```

---

## 2. Page Lock Implementation

### 2.1 Approach: SvelteKit Server Hook

Add IP/page lock logic in `hooks.server.ts`. On every request:

1. Get current user from session
2. If not authenticated, skip (auth pages handle themselves)
3. Query for active contests/assessments where user is a participant AND `pageLockEnabled = true`
4. If found, check if current route is in the allow list
5. If not in allow list, redirect to the contest/assessment page

### 2.2 Allowed Routes (Contest)

- `/contests/[slug]` — contest main page
- `/contests/[slug]/problems/[problemSlug]` — contest problems
- `/contests/[slug]/scoreboard` — scoreboard
- `/api/submissions` — submit code (POST)
- `/api/submissions/[id]` — own submission detail
- `/api/submissions/[id]/stream` — SSE stream
- `/api/submissions/[id]/source` — source code
- `/api/auth/*` — auth endpoints
- `/api/healthz` — health check

### 2.3 Allowed Routes (CourseAssessment)

- `/courses/[slug]/assignments/[assessmentSlug]` — assessment workspace
- Same API routes as above (`/api/submissions/*`, `/api/auth/*`, `/api/healthz`)

### 2.4 Cleanup

Remove the existing navigation guard in `problems/[slug]/+page.server.ts` since the hook handles it globally.

### 2.5 Caching

To avoid querying the DB on every request, cache the active page-locked contest/assessment per user in memory with a short TTL (e.g. 30 seconds). Invalidate when contest starts/ends.

---

## 3. IP Lock Implementation

### 3.1 IP Extraction

Create a utility `getClientIp(request: Request): string`:

- Check `x-forwarded-for` header (first IP in chain)
- Fallback to `request.headers.get('x-real-ip')`
- Fallback to connection remote address
- In development, allow override via `x-dev-ip` header

### 3.2 Check Flow

When a user enters a contest/assessment page (server load function):

```
1. Extract client IP

2. If ipWhitelistEnabled:
   - Check if IP is within any CIDR range in ipWhitelist
   - If not → violation("whitelist")

3. If ipBindingEnabled:
   - Get participation record
   - If boundIp is null → first visit, set boundIp = current IP, boundAt = now()
   - If boundIp !== current IP → violation("binding")

4. violation(type):
   - If ipViolationMode === "block":
     → Return error page, deny access
   - If ipViolationMode === "notify":
     → Log to IpViolationLog
     → Allow access (continue normally)
```

### 3.3 Submission-Time Recheck

In `POST /api/submissions`, if the contest/assessment has any IP lock enabled, run the same checks again. This prevents:

- User loads page from valid IP, switches network, then submits
- In `block` mode: reject the submission
- In `notify` mode: log the violation, allow submission

### 3.4 CIDR Matching

Use a lightweight CIDR matching utility (or `node:net` `isIP` + manual bitmask) to check if an IP falls within a CIDR range. Support both IPv4 and IPv4-mapped IPv6.

---

## 4. Teacher Management UI

### 4.1 Contest/Assessment Settings

Replace the single `ipLockEnabled` checkbox with:

```
[ ] IP Whitelist
    └─ CIDR ranges (one per line): [textarea]
      e.g. 140.112.0.0/16
           192.168.1.0/24

[ ] IP First-Binding (lock to first IP used)

When IP violation occurs:
  (o) Block — deny access completely
  ( ) Notify — allow access, log and notify teacher
```

### 4.2 Violation Log View (notify mode)

Add a section in the contest/assessment management page:

- Table: student name, expected IP, actual IP, violation type, timestamp
- Sortable by time, filterable by student
- Only visible when at least one IP lock option is enabled

---

## 5. Implementation Order

1. **Prisma migration** — schema changes, new models
2. **Core schemas** — update Zod schemas in `packages/core`
3. **IP utility** — `getClientIp()` + CIDR matching
4. **Page Lock hook** — `hooks.server.ts` navigation restriction
5. **IP Lock server logic** — check flow in contest/assessment load + submission API
6. **AssessmentParticipation** — create records on first assessment visit
7. **Management UI** — update contest/assessment settings forms
8. **Violation log UI** — table view for teachers
9. **Tests** — unit tests for CIDR matching, integration tests for lock flows
