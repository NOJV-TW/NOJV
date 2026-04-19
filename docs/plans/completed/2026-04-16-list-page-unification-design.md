# List Page Unification — Shared Header/Tab Shell Across 4 Top-Level List Pages

**Date:** 2026-04-16
**Scope:** `apps/web/src/routes/(app)/{courses,assignments,exams,contests}/+page.svelte`, associated `+page.server.ts` load transforms, paraglide message keys
**Status:** Design approved, awaiting implementation

## Background

Five top-level list pages under `(app)` currently present five different visual frameworks:

| Page           | Header                          | Container width | Tab style                     | Filters                           | Body                                         | State API        |
| -------------- | ------------------------------- | --------------- | ----------------------------- | --------------------------------- | -------------------------------------------- | ---------------- |
| `/problems`    | `<Section>` snippet             | layout default  | custom solid pill (3rd style) | inline search + difficulty + tags | delegated to 700+ line `ProblemsTabs.svelte` | `$page` (legacy) |
| `/courses`     | display h1 + subtitle           | `max-w-6xl`     | border-b underline + count    | `FilterChips` (active/archived)   | 3-col card grid                              | `page` state     |
| `/assignments` | eyebrow + display-sm + subtitle | layout default  | none                          | `FilterChips` (status)            | list rows                                    | `page` state     |
| `/exams`       | eyebrow + display + subtitle    | layout default  | none                          | `FilterChips` (status)            | list rows + date blocks                      | `page` state     |
| `/contests`    | `<Section>` snippet             | layout default  | `bg-muted` pill               | search input + join-code button   | 2-col card grid                              | `$page` (legacy) |

`/courses`, `/assignments`, `/exams` came out of the course-experience redesign (commits `23792f8` / `69e1e9c` / `86b9610`) with a newer design language. `/problems` and `/contests` predate that work and retain an older `<Section>` + `$page`-store structure. The result is visibly incoherent navigation — the same user moves between nav items and every page has a different header typography, tab control, container width, and filter pattern.

## Decisions

1. **Unify the header + tab row across 4 of the 5 pages** (`/courses`, `/assignments`, `/exams`, `/contests`). `/problems` is explicitly out of scope because its 700+ line `ProblemsTabs.svelte` subcomponent mixes tab UI, search, difficulty/tag filters, pagination, create-menu, and card rendering into a single file — reshaping it is a separate refactor.
2. **Do NOT abstract a shared `ListPageShell` component.** Duplicate the structure across the 4 pages so each can diverge later without coordinating a shared surface.
3. **Width**: inherit from `(app)/+layout.svelte`'s `max-w-screen-2xl`. Do not add per-page `max-w-*` wrappers. `/courses` loses its `max-w-6xl` wrapper.
4. **Header**: eyebrow (`text-caption uppercase tracking-[0.12em]`) + `h1` (`font-display text-display font-medium tracking-[-0.02em]`) + body subtitle (`text-body text-muted-foreground`). `/courses` and `/contests` gain new eyebrow message keys.
5. **Tab row**: flex row with tabs on the left (`flex-1`) and action buttons on the right. `border-b border-border` is mounted on the outer row `div`, not on the tablist, so the underline spans the full row width (tabs + empty gap + buttons all sit on the same baseline). Active tab is rendered with `-mb-px border-b-2 border-primary` to visually replace the row border at its position.
6. **Tab count badge**: every tab shows a count pill (`inline-flex min-w-[1.25rem] rounded-full tabular-nums`) — active uses `bg-primary text-primary-foreground`, inactive uses `bg-muted text-muted-foreground`. Mirrors `/courses` current pattern, applied to all 4 pages.
7. **No `FilterChips`** on `/courses`, `/assignments`, `/exams`. The former "filter" dimension collapses into either tabs or is removed:
   - `/courses`: drop the active/archived filter. Archived courses remain in the list with `opacity-60` visual dimming (current styling already does this).
   - `/assignments`: `status` filter becomes tabs `all / open / upcoming / closed`.
   - `/exams`: `status` filter becomes tabs `all / running / upcoming / ended`.
8. **`/contests` keeps its search input** — it's not a filter, and contests can be numerous enough (similar to `/problems`) that free-text search pays its way. Search sits below the tab row in the body area (not in the action region).
9. **`/courses` tab counts include archived courses.** The tab number reflects "all courses under this role", so archived ones contribute to the badge.
10. **URL param rename**: `/assignments` and `/exams` switch from `?status=` to `?tab=` for internal consistency. Shareable links using the old param will be broken; acceptable because these are short-lived filter URLs.
11. **Legacy state API migration**: `/contests/+page.svelte` migrates from `$page` store to `page` state API (matching the other 3 pages).
12. **Animation**: all 4 pages use the existing `animate-in animate-in-1 animate-in-2 animate-in-3` sequence classes. `/contests` gains these (currently has none).

## Per-Page Spec

### `/courses`

```
EYEBROW:  m.courses_eyebrow           (new key)
TITLE:    m.navigation_courses()
SUBTITLE: m.courses_subtitle()

Tabs:
  [Enrolled (n)]  [Managing (n)]               [+ Create New]
                                                 └─ managing tab only, gated on data.canCreate

Body:
  3-col card grid (existing layout), archived courses interleaved with opacity-60
```

- Delete `archivedFilter` state, `setArchivedFilter`, `FilterChips` import, and chip render block.
- `tabCounts` already sums all courses — no change needed.
- `visibleCourses` simplifies to `activeTab === "enrolled" ? data.enrolled : data.managing`.
- Remove the `max-w-6xl mx-auto px-6` wrapper; let the layout handle width.
- Delete the four `emptyEnrolled*` / `emptyManaging*` vs `filter*` orphan i18n keys introduced for the filter.

### `/assignments`

```
EYEBROW:  m.assignmentsTop_eyebrow()
TITLE:    m.assignmentsTop_title()
SUBTITLE: m.assignmentsTop_subtitle()

Tabs:
  [All (n)]  [Open (n)]  [Upcoming (n)]  [Closed (n)]

Body:
  List rows (existing layout unchanged)
```

- Replace `FilterChips` block with the new tab row.
- `data.counts` already exposes `{ all, open, upcoming, closed }`.
- URL param: `?status=` → `?tab=`. Update `+page.server.ts` load to read `url.searchParams.get("tab")`.
- Remove the `sortHint` helper line (it rode with the filter chips and has no room in the new layout).

### `/exams`

```
EYEBROW:  m.examsTop_eyebrow()
TITLE:    m.examsTop_title()
SUBTITLE: m.examsTop_subtitle()

Tabs:
  [All (n)]  [Running (n)]  [Upcoming (n)]  [Ended (n)]

Body:
  List rows with date blocks (existing layout unchanged)
  Info note at bottom linking to /contests (existing, retained)
```

- Same structural change as `/assignments`: `FilterChips` → tab row, `?status=` → `?tab=`.
- `data.counts` already exposes `{ all, running, upcoming, ended }`.

### `/contests`

```
EYEBROW:  m.contests_eyebrow           (new key)
TITLE:    m.navigation_contests()
SUBTITLE: m.contests_subtitle          (new key)

Tabs:
  [Participable (n)]  [Managed (n)]            [Enter code] [+ Create]
                                                 └─ Enter code: outline variant, opens existing Dialog
                                                 └─ Create: default variant, href="/contests/create", gated on data.loggedIn

Body:
  Search input row (existing bg + placeholder, full width)
  2-col card grid (existing layout)
```

- Rewrite header from `<Section>` to eyebrow + display h1 + subtitle.
- Replace `bg-muted` pill tabs with the underline tab row. Tabs gain count badges (`data.participable.length`, `data.managed.length`).
- Move `Enter code` button from the search row to the tab-row action region.
- Move `<Dialog>` trigger: the button binds to `joinDialogOpen = true` (no change to the dialog itself).
- Search input retains its existing position in the body (below the tab row, above the grid). Drop the inline "Enter code" button from this row.
- Migrate `$page` → `page` state: `import { page } from "$app/state"` and replace `$page.url.searchParams` accesses. `codeError` still comes from form action data.
- Remove the wrapping `<Section>` with header/actions snippets.

## Out of Scope

- **`/problems`** — retains current structure. A separate plan should decompose `ProblemsTabs.svelte` before applying the unified shell.
- **Shared `ListPageShell` component** — explicitly rejected in decision 2. If three of the four pages converge further over time, abstracting can be revisited.
- **Cross-page search** — the only page keeping search is `/contests` (by exception for parity with `/problems`' existing search). No new search feature is being added.
- **Header action button alternate layouts** — only `/courses` and `/contests` have action buttons. If `/assignments` or `/exams` later need actions, they add them in the same location without structural change.
- **Sub-page layouts** (`/contests/[slug]`, `/courses/[courseId]`, etc.) — this plan only touches the four top-level list pages.

## Implementation Notes

- The 4 pages are edited independently — no shared file touched. Order of work doesn't matter.
- Paraglide new keys to add (en + zh-TW): `courses_eyebrow`, `contests_eyebrow`, `contests_subtitle`.
- Paraglide keys to remove: `courses_filtersLabel`, `courses_filterActive`, `courses_filterArchived`, `courses_tabsLabel` (tabs no longer need a separate aria label — `<nav aria-label>` on the tablist suffices).
- Orphan-key sweep: run the existing orphan-key prune check after the edits (the project has a prior history of pruning via `pnpm` tooling — see commits `14c6f38` / `28cf6c9` / `690b31d`).
- After edits: `pnpm -w typecheck`, `pnpm lint`, `pnpm -w format`, `pnpm test:unit` all clean.
- Manual verification: open each of the 4 pages in dev, confirm tab switching + counts + action buttons + archived styling on `/courses` + dialog still works on `/contests` + URL param `?tab=` updates on `/assignments` and `/exams`.
