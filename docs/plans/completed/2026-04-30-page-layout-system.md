# Page Layout System (2026-04-30)

## Why

Audit on 2026-04-30 confirmed: **visual tokens (colors, cards, borders) are unified, but page chrome (header pattern, container padding, two-column rules) is hand-rolled per page**. That's why the surface looks consistent but the bones feel random — users get a vague "different page, slightly different layout" signal instead of a clear "different page _type_" signal.

Concrete drift points found:

- **Padding**: list pages inherit root `lg:px-8` (32px), detail layouts add their own `px-6` (24px). 8px drift at `lg`.
- **Eyebrow**: list pages all have one. Detail pages — exam yes, assignment no, problem no.
- **Two-column**: only `courses/[courseId]/+page.svelte` uses `lg:grid-cols-[2fr_3fr]` (announcements | tasks). No documented rule for when to use it.
- **Section spacing**: `mb-8` on list headers, `space-y-6` on detail bodies, `gap-10` on course detail grid — no scale.
- **No shared `<PageHeader>` / `<PageContainer>` / `<PageHero>`** — each page hand-rolls the eyebrow + h1 + description block.

## Design direction

Differentiate pages by **header zone**, not by **body structure**. Body container stays uniform, so users don't get lost. The header zone signals "what kind of page is this" through three archetypes:

### Three archetypes

| Archetype     | Used for                                                                          | Header zone                                                                                  | Body                                                                                                              |
| ------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Index**     | `/courses`, `/exams`, `/assignments`, `/problems` (list pages)                    | Eyebrow + H1 + description + right-side actions (filters, "Create")                          | Single content region. Inside, content owner decides grid vs list.                                                |
| **Hub**       | `/courses/[courseId]` (resource container)                                        | Hero with breadcrumb back-link, H1, meta strip (`student count · taught by`), optional badge | Two-column allowed when sidebar has parallel-important content (announcements alongside tasks). Otherwise single. |
| **Workspace** | `/exams/[examId]`, `/assignments/[assessmentId]`, `/problems/[id]` (focused work) | Hero with breadcrumb, eyebrow, H1, status meta, optional ribbon (countdown, status pill)     | Single-column. Don't fragment focus with a sidebar.                                                               |

### Two-column rule (written down once)

Only use two-column when **both** are true:

1. Sidebar has ≥3 visible items of meaningful parallel content (not a metadata dump).
2. Sidebar can fill ≥30% of the row at `lg+` without looking empty.

If either is false, single-column. Course detail meets it (announcements alongside assignments/exams). Nothing else does today.

### Spacing scale (collapsed to 3)

- `space-y-6` — within-section item gap
- `space-y-10` — section-to-section
- `space-y-16` — major region break (rarely used)

Each archetype binds to one default for its body's top-level rhythm:

- Index: `space-y-6`
- Hub: `space-y-10`
- Workspace: `space-y-6`

## Components (API)

All in `apps/web/src/lib/components/layout/`.

### `<PageContainer>`

Replaces the `pb-24` / `px-6` / `px-6 py-6` ad-hoc wrappers. ONE source of horizontal padding.

```svelte
<PageContainer>
  <slot />
</PageContainer>
```

- Outputs: `<div class="pb-24">{children}</div>`
- Horizontal padding moves to `(app)/+layout.svelte`'s `<main>` (responsive `px-4 sm:px-6 lg:px-10`).
- No more `px-6` on detail layouts. Single point of control.

### `<PageHeader>`

For Index archetype.

```svelte
<PageHeader eyebrow="COURSES" title="Courses" description="...">
  {#snippet actions()}
    <Button>Create</Button>
  {/snippet}
</PageHeader>
```

Props:

- `eyebrow: string` — required (no opt-out; missing eyebrow IS the bug we're fixing)
- `title: string`
- `description?: string`
- `actions?: Snippet` — renders right-aligned, top-aligned

Output:

```html
<header class="animate-in mb-8">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0">
      <p class="text-caption uppercase tracking-[0.12em] text-muted-foreground">{eyebrow}</p>
      <h1 class="mt-1 font-display text-display font-medium tracking-[-0.02em]">{title}</h1>
      {#if description}
      <p class="mt-2 text-body text-muted-foreground">{description}</p>
      {/if}
    </div>
    {#if actions}
    <div class="flex shrink-0 items-center gap-2">{@render actions()}</div>
    {/if}
  </div>
</header>
```

### `<PageHero>`

For Hub + Workspace archetypes. Replaces hand-rolled hero blocks in `CourseHero`, `exams/[examId]/+page.svelte` lines 151-216, `assignments/[assessmentId]/+page.svelte` corresponding block.

```svelte
<PageHero
  variant="hub" | "workspace"
  breadcrumbHref="/courses"
  breadcrumbLabel="Courses"
  eyebrow="EXAM"
  title={detail.title}
>
  {#snippet meta()}
    <Badge ... />
    <span>...</span>
  {/snippet}
  {#snippet actions()}
    <Button>Override</Button>
  {/snippet}
  {#snippet ribbon()}
    <CountdownCard ... />
  {/snippet}
</PageHero>
```

Props:

- `variant: "hub" | "workspace"` — controls bottom border + spacing
- `breadcrumbHref: string`
- `breadcrumbLabel: string`
- `eyebrow?: string` — workspace requires (e.g. "EXAM"), hub omits
- `title: string`
- `meta?: Snippet` — meta strip below h1 (badges, dates, counts)
- `actions?: Snippet` — right of h1 (manager actions, badges)
- `ribbon?: Snippet` — full-width row below the meta strip (countdowns)

Output structure:

```html
<section class="border-b border-border pb-7 pt-2">
  <BreadcrumbBackLink ... />
  <!-- one consistent breadcrumb style -->
  <div class="mt-4 flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0 flex-1">
      {#if eyebrow}
      <p class="text-caption ...">{eyebrow}</p>
      {/if}
      <h1 class="mt-2 font-display text-display ...">{title}</h1>
      {#if meta}
      <div class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 ...">{@render meta()}</div>
      {/if}
    </div>
    {#if actions}
    <div class="flex shrink-0 items-center gap-2">{@render actions()}</div>
    {/if}
  </div>
  {#if ribbon}
  <div class="mt-8">{@render ribbon()}</div>
  {/if}
</section>
```

`CourseHero` becomes a thin wrapper around `<PageHero variant="hub">` to avoid touching every course consumer at once.

## Page mapping

| Path                                                    | Archetype | Migration                                                                                                                  |
| ------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/courses` (`+page.svelte`)                             | Index     | swap header block → `<PageHeader>`                                                                                         |
| `/exams` (`+page.svelte`)                               | Index     | swap header block → `<PageHeader>`                                                                                         |
| `/assignments` (`+page.svelte`)                         | Index     | swap header block → `<PageHeader>`                                                                                         |
| `/problems` (`+page.svelte`)                            | Index     | swap header block → `<PageHeader>`; ADD missing eyebrow `m.problems_eyebrow()`                                             |
| `/courses/[courseId]` (layout + `+page.svelte`)         | Hub       | `CourseHero` → `<PageHero variant="hub">`; layout uses `<PageContainer>` (no more `px-6`)                                  |
| `/exams/[examId]` (`+page.svelte`)                      | Workspace | hand-rolled hero (lines 151-216) → `<PageHero variant="workspace">` with `ribbon` snippet for countdown                    |
| `/assignments/[assessmentId]` (`+page.svelte` + layout) | Workspace | layout drops `px-6 py-6`; `+page.svelte` uses `<PageHero variant="workspace">`; add eyebrow `m.assignmentDetail_eyebrow()` |

Out of scope for this pass (cover in follow-ups): contests, dashboard, admin, manage screens. The point is to land the system + cover the four areas the user called out, then sweep.

## Phases

1. **Plan + spec** — this doc.
2. **Build elements** — `<PageContainer>`, `<PageHeader>`, `<PageHero>` + `BreadcrumbBackLink` (extracted from `CourseHero` ChevronLeft anchor).
3. **Root layout fix** — move padding to `(app)/+layout.svelte`'s `<main>`, drop `px-6` from `courses/[courseId]/+layout.svelte` and `assignments/[assessmentId]/+layout.svelte`.
4. **List page sweep** — courses, exams, assignments, problems use `<PageHeader>`. Add `problems_eyebrow` paraglide key.
5. **Detail page sweep** — `CourseHero` rewires onto `<PageHero variant="hub">`; exam + assignment detail rewire onto `<PageHero variant="workspace">`. Add `assignmentDetail_eyebrow` key.
6. **Verify** — `pnpm -w typecheck`, `pnpm lint`, `pnpm -w format`. Visual smoke test 7 routes.

## Non-goals

- Not changing card styles, badge styles, or button styles. Pure layout-spine work.
- Not adding new colors or tokens.
- Not unifying the contest hero (its own thing, scoreboard-driven). Will sweep later if archetypes prove out.
- Not rewriting `ProblemsTabs`, `ExamSubmissionsMatrix`, etc. — only their parent header.

## Risks

- **CourseHero used by many course sub-routes** — keeping the existing component as a thin wrapper avoids a fan-out edit.
- **Paraglide message keys** — adding 2 keys (`problems_eyebrow`, `assignmentDetail_eyebrow`). Need to run `pnpm exec paraglide-js compile` after editing `messages/*.json`.
- **`pb-24` vs `pb-20`** — current code uses both. Standardise on `pb-24` for list pages (existing pattern), keep detail pages' inner `pb-20` since it accounts for the hero.

## Verification

After all phases:

- [ ] `pnpm -w typecheck` — 17/17 green
- [ ] `pnpm lint` — 18/18 green
- [ ] `pnpm -w format` — clean
- [ ] Manual: load `/courses`, `/exams`, `/assignments`, `/problems`, `/courses/<id>`, `/exams/<id>`, `/assignments/<id>` — eyebrow present everywhere; padding visually consistent at `lg+`; no double-breadcrumbs.
