# NOJV Exhibition Demo Playbook

This playbook is for on-stage demos to general audiences and technical visitors.
It is designed to showcase end-to-end platform value in one flow: authoring -> delivery -> anti-cheat -> operations.

## 1. Demo Goal

Show these capabilities in one coherent story:

1. Create and manage problems (including non-trivial judge modes).
2. Operate course assessments and contest workflows.
3. Demonstrate security controls (page lock, IP policy, language restriction, cooldown/attempt limits).
4. Run plagiarism checks and inspect side-by-side source comparisons.
5. Demonstrate operational visibility (queue/system/admin controls).
6. Show engineering reliability checks added in this iteration (seed validation and hardening).

## 2. Runtime And Accounts

## Environment

1. Node.js >= 24
2. pnpm 10.x
3. Docker Desktop running

## Boot commands

```bash
pnpm install
docker compose up -d
pnpm db:generate
pnpm db:push
pnpm db:seed:validate
pnpm db:seed
pnpm sandbox:build
pnpm dev
```

## Demo accounts (from seed)

All accounts use password `password123`.

1. Admin: `admin` or `admin@nojv.local`
2. Teacher: `teacher` or `teacher@nojv.local`
3. TA Student: `ta-student` or `ta-student@nojv.local`
4. Student: `student` or `student@nojv.local`

Login page for credential demo: `/admin-signin`

## Seeded entities to use on stage

1. Course: `os-lab-spring-2026`
2. Course assessment: `hw1-process-trace`
3. Course-linked contest: `midterm-systems-lab`
4. Public contest: `spring-qualifier-2026` (invite code `spring2026`)
5. Newly added hard problems:
   - `stateful-dhcp-parser` (function)
   - `memory-leak-forensics` (function)
   - `noisy-oracle-hunt` (interactive)

## 3. 10-Minute Pre-Show Checklist

Run this before audience entry.

1. Open 3 browser profiles/windows:
   - Window A: Admin
   - Window B: Teacher
   - Window C: Student/TA Student
2. Verify seed hardening gate:

```bash
pnpm db:seed:validate
```

3. In Teacher window, open `/courses/os-lab-spring-2026/manage/assessments` and create a live demo assessment:
   - Title: `Demo HW Live`
   - Slug: `demo-hw-live`
   - Scoreboard mode: `hidden`
   - Problems: `warmup-sum, process-log-parser`
   - Opens: now - 5 min
   - Due: now + 20 min
   - Closes: now + 30 min
   - Enable `pageLockEnabled` (optional for lock redirect demo)
   - Enable `ipBindingEnabled` with `notify` if you want to show policy setup
4. In Teacher window, open `/contests/create` and create a live contest:
   - Slug: `demo-live-contest`
   - Title: `Demo Live Contest`
   - Problems: `warmup-sum, graph-docking`
   - Starts: now - 2 min
   - Ends: now + 25 min
   - Scoreboard mode: `frozen`
   - Freeze at: now + 15 min
   - Enable `pageLockEnabled`
   - Enable `ipBindingEnabled` (notify)
   - Set `submitCooldownSec` to `20` to demonstrate cooldown protection
5. Generate demo data:
   - Student and TA Student each submit accepted code once on `warmup-sum` in `demo-hw-live`.
   - Student submit once in `demo-live-contest` to populate scoreboard.
6. Quick accepted code snippet for `warmup-sum`:

```python
a, b = map(int, input().split())
print(a + b)
```

## 4. On-Stage Timeline (25 minutes)

## Minute 0-2: Platform framing

Screen: landing/dashboard + quick architecture slide.

Say:
"This is one platform for contests, coursework, anti-cheat, and operations."

Show:

1. `/dashboard`
2. One-sentence architecture summary from README

## Minute 2-5: Reliability and hardening proof

Screen: terminal.

Show:

1. `pnpm db:seed:validate` success
2. Explain: seed fails fast before DB writes, catches missing scripts/templates/testcases and invariant violations.

Say:
"Before we demo features, we verify data integrity as a deployment guardrail."

## Minute 5-9: Problem authoring power

Screen: `/problems/create`

Show:

1. Judge modes: standard/checker/interactive.
2. Submission modes: full source/function template.
3. Template editor + testcase section.

Then switch to `/problems` and open these slugs:

1. `stateful-dhcp-parser`
2. `memory-leak-forensics`
3. `noisy-oracle-hunt`

Say:
"These are intentionally non-trivial tasks, including function-mode and adversarial interactive judging."

## Minute 9-14: Course operations

Screen: Teacher window `/courses/os-lab-spring-2026/manage`

Walk through tabs:

1. Members: `/courses/os-lab-spring-2026/manage/members`
2. Problems: `/courses/os-lab-spring-2026/manage/problems`
3. Assessments: `/courses/os-lab-spring-2026/manage/assessments`
4. Progress matrix: `/courses/os-lab-spring-2026/manage/progress`

Say:
"This gives a teacher one cockpit for roster, assignment publishing, and learning progress visibility."

## Minute 14-18: Contest and security controls

Screen: `/contests/demo-live-contest` then `/contests/demo-live-contest/scoreboard`

Show:

1. Contest timer and status.
2. Security tags (page lock/IP policy/language restrictions if set).
3. Frozen scoreboard behavior.
4. In Admin or Teacher role, open `/contests/demo-live-contest/scoreboard` and click `Unfreeze Board`.

Optional page-lock redirect demo:

1. In Student window (already inside active contest), manually navigate to `/dashboard`.
2. Show redirect back to contest context.

## Minute 18-23: Plagiarism workflow

Screen: Teacher window `/courses/os-lab-spring-2026/manage/assessments`

Flow:

1. Click `Run Plagiarism Check` for `Demo HW Live`.
2. Narrate status transitions: `Starting -> Pending -> Running -> Completed`.
3. Click `View Results`.
4. In results page, lower similarity threshold to `0` when running without MOSS credentials.
5. Click `Compare` to open side-by-side code.

Say:
"Teachers can trigger anti-cheat checks on demand and inspect suspicious pairs without leaving the platform."

## Minute 23-25: Admin operations close

Screen sequence:

1. `/admin/users` (role update / disable toggle)
2. `/admin/announcements` (publish/pin workflow)
3. `/admin/system` (DB + queue health, failed jobs and retry/remove actions)

Close line:
"This is not only an OJ UI. It is an operationally managed learning and contest platform."

## 5. Demo Script Prompts (Speaker Notes)

Use these short lines to keep pacing.

1. "I will show the full lifecycle: create, submit, rank, detect anomalies, and operate."
2. "First, we verify data integrity guardrails, then we show product behavior."
3. "Now we switch from author view to teacher operations."
4. "This step is anti-cheat: trigger, monitor, inspect, and compare source."
5. "Finally, this admin console is what makes the system survivable in production."

## 6. Failure Handling (Plan B)

## If plagiarism returns no rows

1. Set threshold slider to `0`.
2. Confirm at least two accepted submissions exist for the same problem and scope.
3. Re-run from assessments page.

## If queue or worker is delayed

1. Use `/admin/system` to show queue backlog.
2. Continue with already completed submissions/reports.
3. Narrate async architecture: web remains responsive while jobs are processed.

## If contest not active

1. Open `/contests/create` and create a short live contest starting now.
2. Re-run page lock/frozen board segment on the new contest.

## If role permission blocks action

1. Verify current user in top-right/account context.
2. Switch to correct window profile (Admin or Teacher).

## 7. Feature Coverage Matrix

Use this table to ensure "all current work" is covered on stage.

Legend:

1. Full: can operate this feature directly in demo.
2. View: can view or experience the feature but not manage it.
3. No: not expected to access this feature in normal flow.

| Feature | Admin | Teacher | TA | Student |
| --- | --- | --- | --- | --- |
| Platform admin panel (`/admin/users`, `/admin/system`, `/admin/announcements`) | Full | No | No | No |
| Create problem (`/problems/create`) | Full | Full | No | No |
| Advanced judge modes (standard/checker/interactive) | Full | Full | View | View |
| Function template authoring | Full | Full | View | View |
| High-difficulty seeded problems (`stateful-dhcp-parser`, `memory-leak-forensics`, `noisy-oracle-hunt`) | Full | Full | View | View |
| Create course (`/courses`) | Full | Full | No | No |
| Course manage panel (`/courses/{slug}/manage/*`) | Full | Full | Full | No |
| Course members management | Full | Full | Full | No |
| Attach/manage course problem set | Full | Full | Full | No |
| Publish assessment | Full | Full | Full | No |
| Course progress matrix + CSV export | Full | Full | Full | View |
| Trigger plagiarism check | Full | Full | Full | No |
| Plagiarism results + side-by-side source compare | Full | Full | Full | No |
| Create public contest (`/contests/create`) | Full | Full | Full (unbound only) | Full (unbound only) |
| Bind contest to course | Full | Full | No | No |
| Contest participation (`/contests/{slug}`) | View | View | View | View |
| Scoreboard unfreeze (`/contests/{slug}/scoreboard`) | Full | Full | No | No |
| Contest security controls (page lock, IP whitelist, IP binding, violation mode) | Full | Full | Full (course scope) | View/Enforced |
| Language restriction enforcement (contest/assessment) | Configure + View | Configure + View | Configure + View (course scope) | Enforced |
| Submit cooldown / max attempts enforcement | Configure + View | Configure + View | Configure + View (course scope) | Enforced |
| Seed reliability gate (`pnpm db:seed:validate`) | Full | Full | View | View |

## 8. Post-Demo Reset (Optional)

If you need a clean rerun environment:

```bash
pnpm db:push
pnpm db:seed:validate
pnpm db:seed
```

Then recreate `demo-hw-live` and `demo-live-contest` using the pre-show checklist.