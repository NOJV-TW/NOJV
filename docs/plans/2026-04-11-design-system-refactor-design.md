# Design System Refactor — 48-Principle UI/UX Baseline

**Date**: 2026-04-11
**Branch**: `design-system-refactor`
**Scope**: Full sweep of `apps/web` — tokens, base components, and every
application route.

This document records the 48-principle design system encoded into
NOJV during the 2026-04-11 refactor, the implementation mapping, and
known follow-ups.

---

## 1. Why

Before this refactor the UI had strong brand identity (warm cream +
burnt orange + Fraunces editorial) but no shared craft baseline.
Common problems across the codebase:

- `rounded-[2rem]` arbitrary values everywhere, no concentric
  corner-radius discipline
- Single `shadow-sm` layer (flat, not realistic)
- `mt-6 / mt-4 / mt-8` random spacing, no 4/8pt rhythm
- `text-3xl / text-5xl` raw scale, no semantic type system
- Hardcoded `text-green-600`, `bg-emerald-500/30` etc. instead of
  semantic tokens
- Empty states: bare `<p>` with no onboarding
- Error messages: generic, no cause + fix
- No keyboard shortcuts / power-user affordances
- No state preservation across navigation

The goal was to encode a **48-principle design baseline** — a mix of
**frontend visual craft** and **UX interaction principles** — into the
repo so every future feature gets them for free.

---

## 2. The 48 Principles

### Visual craft (28)

| #   | Principle                                            | Category    |
| --- | ---------------------------------------------------- | ----------- |
| 1   | Concentric corner radius (inner = outer − padding)   | Geometry    |
| 2   | Optical alignment (visual vs mathematical centering) | Geometry    |
| 3   | 4/8pt spacing scale                                  | Geometry    |
| 4   | Elevation ladder (rest/hover/modal)                  | Depth       |
| 5   | Border contrast ladder (subtle/default/strong)       | Depth       |
| 6   | Tabular figures for numeric data                     | Typography  |
| 7   | Type scale with 1.25 ratio                           | Typography  |
| 8   | Optical margin alignment (hanging punct.)            | Typography  |
| 9   | Motion curves (ease-out enter, ease-in exit)         | Motion      |
| 10  | Focus ring with offset                               | Interaction |
| 11  | Hover lift (unified translate + elevation)           | Interaction |
| 12  | Disabled opacity standardized                        | State       |
| 13  | Line-length cap (max-w-[65ch])                       | Typography  |
| 14  | Leading fixed per text role                          | Typography  |
| 15  | Layered box shadows (Stripe/Vercel style)            | Depth       |
| 16  | OKLCH gradient interpolation                         | Color       |
| 17  | `color-mix()` derived state colors                   | Color       |
| 18  | `text-wrap: balance` on headings                     | Typography  |
| 19  | `text-wrap: pretty` on paragraphs                    | Typography  |
| 20  | Baseline alignment for mixed font sizes              | Typography  |
| 21  | Font optical sizing (Fraunces)                       | Typography  |
| 22  | Icon stroke matches text weight                      | Icons       |
| 23  | Icons sized via 1em                                  | Icons       |
| 24  | `:focus-visible` not `:focus`                        | Interaction |
| 25  | Transform with `translate3d` (GPU layer)             | Motion      |
| 26  | `scroll-margin-top` for anchor jumps                 | Navigation  |
| 27  | `overscroll-behavior: contain` for modals            | Interaction |
| 28  | Container queries (optional)                         | Layout      |

### UX design (20)

| #   | Principle                               | Category  |
| --- | --------------------------------------- | --------- |
| 1   | Doherty threshold (<400ms feedback)     | Cognitive |
| 2   | Hick's Law (limit options)              | Cognitive |
| 3   | Miller's Law (7±2 working memory)       | Cognitive |
| 4   | Jakob's Law (feel like known products)  | Cognitive |
| 5   | Peak-end rule (design peaks + endings)  | Cognitive |
| 6   | Aesthetic-usability effect              | Cognitive |
| 7   | Zeigarnik effect (unfinished markers)   | Cognitive |
| 8   | Visibility of system status             | Nielsen   |
| 9   | User control + freedom (undo > confirm) | Nielsen   |
| 10  | Error prevention > recovery             | Nielsen   |
| 11  | Recognition over recall                 | Nielsen   |
| 12  | Keyboard shortcuts for experts          | Nielsen   |
| 13  | Error messages: cause + fix             | Nielsen   |
| 14  | Empty state as onboarding               | Pattern   |
| 15  | Optimistic UI updates                   | Pattern   |
| 16  | Skeleton screens over spinners          | Pattern   |
| 17  | Sensible defaults                       | Pattern   |
| 18  | Breadcrumbs for ≥3 levels               | IA        |
| 19  | State preservation on back              | IA        |
| 20  | Feedback tier by response budget        | Feedback  |

---

## 3. Execution Plan

Bottom-up waterfall across 3 phases, with parallelism inside each
phase. 13 parallel agents total (6 for base components, 7 for page
sweep), 4 sync gates owned by the orchestrator.

```
Batch A — Design Tokens (sync)
   │
   ▼
Batch B — 6 parallel agents on base components
   │
   ▼ Sync gate: merge barrel + verify
   │
Batch C — 7 parallel agents on page clusters
   │
   ▼ Sync gate: merge paraglide + verify
   │
Batch D — Design doc + final verify (this file)
```

---

## 4. Implementation Mapping

### Batch A: Design Tokens (`apps/web/src/app.css`)

Seven-axis primitive token system registered in `:root` and mirrored
into `@theme inline` so Tailwind 4 generates utilities:

**1. Color** — warm cream base (`#f7f1e8`) + burnt orange (`#c4682d`)
preserved; semantic `--success / --warning / --info / --destructive`
added as OKLCH values. Chart palette rebalanced to warm-earth
(sage, warm brown, amber, slate) to match brand.

**2. Radius** — 8-step concentric-friendly scale:

```
--radius-xs:  6px    — tags, micro-pills
--radius-sm:  8px    — inputs, small buttons, inner elements
--radius-md:  12px   — default buttons, form fields
--radius-lg:  16px   — small cards, popovers
--radius-xl:  24px   — medium cards, modals
--radius-2xl: 32px   — large cards (hero, panel)
--radius-3xl: 40px   — showcase cards
--radius-full: 9999px
```

Concentric pair reference:

```
rounded-3xl (40) + p-8  (32) → inner rounded-sm (8)
rounded-2xl (32) + p-6  (24) → inner rounded-sm (8)
rounded-xl  (24) + p-4  (16) → inner rounded-sm (8)
rounded-lg  (16) + p-2  (8)  → inner rounded-sm (8)
```

**3. Shadow elevation ladder** — Stripe/Vercel layered style:

```
--shadow-rest:   3 stacked shadows (subtle base elevation)
--shadow-hover:  4 stacked shadows (raised on hover)
--shadow-modal:  3 stronger shadows (lifted modals/sheets)
--shadow-focus:  3px primary ring for focus states
```

Dark mode gets its own ladder (darker, warmer tint).

**4. Motion**:

```
--duration-instant:  80ms
--duration-fast:     160ms
--duration-normal:   240ms
--duration-slow:     320ms
--duration-page:     400ms

--ease-out-soft:    cubic-bezier(0.22, 1, 0.36, 1)
--ease-in-soft:     cubic-bezier(0.64, 0, 0.78, 0)
--ease-in-out-soft: cubic-bezier(0.65, 0, 0.35, 1)
--ease-spring:      cubic-bezier(0.34, 1.56, 0.64, 1)
```

**5. Type scale** (1.25 ratio, semantic):

```
text-micro     11px  — eyebrow only
text-caption   12px  — captions, tags
text-body-sm   14px  — dense body
text-body      16px  — default body
text-body-lg   18px  — emphasized body
text-title-sm  20px  — small headings
text-title     24px  — section headings
text-title-lg  30px  — page titles
text-headline  36px  — headlines
text-display   48px  — display
text-display-lg 60px — hero display
```

**6. Border contrast ladder**:

```
--border-subtle:  rgba(79,52,35,0.08)  — dividers, inner lines
--border:         rgba(79,52,35,0.14)  — default card/input
--border-strong:  rgba(79,52,35,0.24)  — emphasized outlines
```

**7. Z-index** (8-step named):

```
--z-base 0, --z-docked 10, --z-sticky 20, --z-overlay 30,
--z-dropdown 40, --z-modal 50, --z-toast 60, --z-tooltip 70
```

**Global baseline refinements applied in `@layer base`**:

- `text-wrap: balance` on `h1–h4`, `text-wrap: pretty` on `p`
- OKLCH gradient interpolation on body + dark body background
- `font-optical-sizing: auto` on `.font-display` (Fraunces)
- `scroll-margin-top: 5rem` on all `[id]`
- `font-variant-numeric: tabular-nums` on `code / kbd / time /
.font-mono`
- `:focus-visible` with `outline-offset: 2px`, `:focus` suppressed
- `min-height: 100dvh` on body
- `overscroll-behavior: contain` on `[data-scroll-lock]`
- `@media (prefers-reduced-motion: reduce)` hard-disables animations

### Batch B: Base Components (`apps/web/src/lib/components/ui/`)

Six parallel agents built 30+ files consuming Batch A tokens:

**Button family** (`ui/button/`):

- `button.svelte` — refactored with layered shadows, scoped motion
  transition, hover lift (motion-safe), active scale 0.98, loading
  prop with stable width, tabular-nums, focus ring with offset,
  touch target ≥40px
- `IconButton.svelte` — icon-only with required `label` prop, size
  mapped to icon-sm/md/lg, defaults to `ghost`
- `LinkButton.svelte` — anchor with `buttonVariants()`,
  `variant="link"` default

**Card family** (`ui/card/`):

- `card.svelte` — rewritten with `tailwind-variants`: 5 variants
  (`surface/strong/flat/elevated/outline`) × 4 sizes (`sm/md/lg/hero`)
  with concentric padding/radius pairs; removed hardcoded
  `rounded-[2rem]`; base uses `shadow-rest`
- sub-components updated: `card-title.svelte` uses `font-display +
text-title + text-wrap: balance`, `card-description.svelte` uses
  `text-body-sm + text-wrap: pretty`

**Standalone primitives**:

- `Section.svelte` — semantic page section with `header` / `actions`
  snippets, no background (not a card)
- `Panel.svelte` — wrapper over `Card` with defaults `variant="strong"`
  `size="sm"` — designed to nest inside another Card with concentric
  radius
- `StatCard.svelte` — numeric tile with label + value (font-display +
  tabular-nums) + optional trend badge + optional Lucide icon
- `FormField.svelte` — wraps label + control + hint + error; error
  replaces hint when present

**Skeleton family** (`ui/skeleton/`):

- `Skeleton.svelte` — base primitive with `text/circle/block`
  variants; shimmer via `motion-safe:` / `motion-reduce:hidden`
- `SkeletonText.svelte` — multi-line with realistic last-line width
- `SkeletonCard.svelte` / `SkeletonList.svelte` /
  `SkeletonTable.svelte` / `SkeletonStat.svelte` — domain-shaped
- `LoadingTier.svelte` — Doherty-threshold orchestrator (instant
  tier <400ms hides placeholder, skeleton tier 400ms–2s, slow tier
  > 2s shows both skeleton and slow message)

**Toast family** (`ui/toast/`):

- `toast.ts` store — extended with undo action support, max 5
  concurrent FIFO, sticky (duration=0) mode, 4s default auto-dismiss,
  backward-compatible `add()` wrapper for existing callers
- `ToastContainer.svelte` — thin container with mobile full-bleed
  layout, z-[var(--z-toast)]
- `toast/ToastItem.svelte` — single-toast visual with icon container,
  optional undo button (Button ghost pill), concentric radius, spring
  entrance, exit 58% of enter duration, reduced-motion variant

**Empty state + shortcuts**:

- `EmptyState.svelte` — backward-compatible refactor with two
  variants: `minimal` (existing) and `onboarding` (multiple actions,
  tips list, docs link)
- `KeyboardShortcut.svelte` — visual key pill with Mac/PC symbol
  mapping, supports single combo (`["Ctrl","Enter"]`) and sequence
  (`[["G"],["D"]]`)
- `ShortcutOverlay.svelte` — `?` cheat sheet modal grouped by
  category, driven by the `shortcuts` store
- `shortcuts.svelte.ts` — generic registry with `register /
unregister / toggleOverlay / handleKeydown`, 1500ms sequence
  timeout, ignores input/textarea/contenteditable unless
  `allowInInputs`, built-in `?` binding, `useGlobalShortcuts()`
  `$effect` helper

**Badge + Input**:

- `badge.svelte` — 8 new variants (`success/warning/info/muted +
verdict-ac/wa/tle/mle/re/ce/pending/partial`), 3 sizes (xs/sm/md),
  `dot` prop for status indicators, tabular-nums on base
- `input.svelte` — `h-11` touch target, `shadow-rest` rest state,
  focus ring with offset, motion transition, tabular-nums for
  number type, `text-base` (16px) to prevent iOS auto-zoom

### Batch C: Page Sweep (7 agents × ~30 routes)

All 30+ route files now consume Batch B components and Batch A
tokens. Key transformations applied uniformly:

- `rounded-[2rem]` → `rounded-2xl`
- `rounded-[1.5rem]` → `rounded-xl`
- `shadow-sm / shadow-xs` → `shadow-rest`
- `text-3xl / text-4xl / text-5xl` → `text-title-lg / text-headline /
text-display`
- `font-[family-name:var(--font-display)]` → `font-display`
- Raw status pills → `<Badge variant>` with semantic variant
- Empty `<p>No X</p>` blocks → `<EmptyState variant>` (minimal or
  onboarding)
- Raw buttons → `<Button>` with loading states
- Verdict display → `<Badge variant="verdict-*">` via helper map
- Chart colors → `var(--chart-1..5)` (warm-earth palette)

**Highlights per cluster**:

- Root layout wires `useGlobalShortcuts()` + `<ShortcutOverlay />`
  globally; Header refactored with sticky glass nav + registers
  `g+d/p/c/s` sequence shortcuts for signed-in users
- Dashboard: StatCard trio + verdict Badge mapping + activity chart
  recolored to `var(--chart-5)` sage
- Scoreboard: Card wrapper + verdict-tinted cells + `tabular-nums`
  ranks + `font-display` rank + `var(--chart-*)` IOI line chart
- Plagiarism page: full i18n pass (27 English strings → paraglide
  keys) alongside token migration
- Admin announcements: Section + Card + FormField + IconButton row
  actions + onboarding EmptyState
- Auth pages: elevated hero Card, FormField-wrapped inputs, error
  box in destructive token styling

### Sync gate adjustments

- Added `--text-* / --font-* / --leading-* / --duration-*` to
  `@theme inline` so Tailwind generates utilities (otherwise agents
  had to use `text-[length:var(--...)]` arbitrary syntax)
- Stripped 9 files of leaked agent tool-call syntax
  (`</content></invoke>` written into route files during Batch C
  parallel dispatch)
- Added ~80 paraglide keys across en.json + zh-TW.json
- Recompiled paraglide after each sync gate

---

## 5. Verification

Each batch ended with a full verification gate:

| Check                           | Result                            |
| ------------------------------- | --------------------------------- |
| `svelte-check`                  | 0 errors, 0 warnings (8686 files) |
| `pnpm -w typecheck`             | 17/17 packages green              |
| `pnpm lint`                     | 18/18 green                       |
| `pnpm test:unit`                | 20 files / 154 tests passing      |
| `pnpm --filter @nojv/web build` | Success                           |
| `pnpm format:write`             | Clean                             |

---

## 6. Known Follow-ups

### Out of scope for this refactor

- `apps/web/src/lib/components/problem/Tabs.svelte` (the real
  problems list) — C3 agent discovered the routes are thin wrappers
  and the list lives in this component. Token migration of Tabs is
  a separate pass.
- `apps/web/src/lib/components/{manage,course,auth,problem}/*`
  subcomponents — many sub-components under these directories still
  use `rounded-[2rem]` or raw spans. Sweeping them is additive and
  can happen in a Batch E without touching routes.
- Admin dashboards (`admin/+page.svelte`, `admin/users/+page.svelte`)
  use inline `t()` helpers with a `{ en, zh }` dict instead of
  paraglide. That's a separate i18n pass.

### Design-token gaps

- `text-*` size tokens and `font-*` family tokens were initially
  NOT in `@theme inline` (only `:root`), forcing Batch B agents to
  use `text-[length:var(--text-title)]` arbitrary syntax. Fixed in
  the Batch B sync gate.
- `rounded-4xl` was referenced by a few legacy files but never
  existed in the scale. Migrated to `rounded-3xl` (40px) during
  Batch C.
- Textarea primitive doesn't exist in `ui/`; C7 inline-styled
  announcement textareas with Input tokens. A dedicated `Textarea`
  component would reduce duplication.

### UX principles partially applied

- **#15 Optimistic UI** — plumbing exists (Toast undo + store) but
  not yet wired into specific actions (delete/star/upvote). Callers
  need to opt in per-action.
- **#17 Sensible defaults** — problem creation time/memory defaults
  already exist via Zod schemas; no additional work needed.
- **#18 Breadcrumbs** — no breadcrumb component yet. Courses pages
  are ≥3 levels deep and would benefit.
- **#20 Feedback tier (LoadingTier)** — component exists but not yet
  used on pages that do client-side refresh (scoreboard auto-refresh,
  search debounce). Opt-in per page.

### Latent bug fixes noticed

- Root `+layout.svelte` now mounts `ToastContainer` globally (was
  previously only mounted inside `(app)/+layout.svelte`, so toasts
  fired from auth or marketing pages were silently lost). Moved to
  root to fix.
- `(auth)/+layout.svelte` was painting its own `bg-gradient-to-br`
  that competed with the global warm-cream radial gradient in
  `app.css`. Dropped.

### MEMORY.md misconceptions corrected

- `IpViolationMode` Prisma enum conversion — still not landed
  (already flagged round 3)
- `@theme inline` text-token gap — now fixed in this refactor

---

## 7. File Inventory

**Created** (26 files):

```
apps/web/src/lib/components/ui/FormField.svelte
apps/web/src/lib/components/ui/KeyboardShortcut.svelte
apps/web/src/lib/components/ui/LoadingTier.svelte
apps/web/src/lib/components/ui/Panel.svelte
apps/web/src/lib/components/ui/Section.svelte
apps/web/src/lib/components/ui/ShortcutOverlay.svelte
apps/web/src/lib/components/ui/StatCard.svelte
apps/web/src/lib/components/ui/button/IconButton.svelte
apps/web/src/lib/components/ui/button/LinkButton.svelte
apps/web/src/lib/components/ui/skeleton/Skeleton.svelte
apps/web/src/lib/components/ui/skeleton/SkeletonCard.svelte
apps/web/src/lib/components/ui/skeleton/SkeletonList.svelte
apps/web/src/lib/components/ui/skeleton/SkeletonStat.svelte
apps/web/src/lib/components/ui/skeleton/SkeletonTable.svelte
apps/web/src/lib/components/ui/skeleton/SkeletonText.svelte
apps/web/src/lib/components/ui/skeleton/index.ts
apps/web/src/lib/components/ui/toast/ToastItem.svelte
apps/web/src/lib/components/ui/toast/index.ts
apps/web/src/lib/stores/shortcuts.svelte.ts
docs/plans/2026-04-11-design-system-refactor-design.md  (this file)
```

**Modified**:

- `apps/web/src/app.css` — full token rewrite
- `apps/web/messages/en.json`, `apps/web/messages/zh-TW.json` — ~80
  new keys
- `apps/web/src/lib/paraglide/**` — regenerated
- All 9 button/card/badge/input sub-components
- `EmptyState`, `ToastContainer`, `toast.ts` store
- All 30+ route files under `apps/web/src/routes/**`
- `Header.svelte`, `ThemeToggle.svelte`

---

## 8. Commit History

```
697ad83  feat(design): Batch A — 48-principle design token foundation
070884b  feat(design): Batch B — base components consume tokens
a3e5580  feat(design): Batch C — page sweep applies components
[next]   feat(design): Batch D — design document + final verify
```
