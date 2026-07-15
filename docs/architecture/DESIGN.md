# Design

Design guidance matters in this repository because NOJV is a tool that students and teachers use under time pressure -- during exams, contests, and assignment deadlines. Clarity, speed, and trust in the interface directly affect whether users can focus on problem-solving rather than fighting the UI.

## Implemented Design System

### CSS Framework

Tailwind CSS 4 with `tw-animate-css` for animation utilities. Components use `tailwind-variants` (`tv()`) for variant-driven styling and `tailwind-merge` via the `cn()` utility from `$lib/utils/css.ts` for conditional class merging. The `clsx` library handles class composition before merge.

The `@theme inline` block in `app.css` maps CSS custom properties to Tailwind color tokens (`--color-primary`, `--color-muted`, etc.) so all design tokens are usable as Tailwind classes (`bg-primary`, `text-muted-foreground`).

### Component Library

Bits UI (headless Svelte components, similar to Radix) provides accessible primitives. Shipped Bits UI integrations: Dialog, RadioGroup, Select, Separator, Tooltip. These are wrapped in styled components under `$lib/components/primitives/ui/`.

shadcn-svelte-style components in `$lib/components/primitives/ui/`:

| Component | Variants / Notes                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Button    | `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`; sizes: `default`, `sm`, `lg`, `icon`, `icon-sm`, `icon-lg` |
| Badge     | `default`, `secondary`, `destructive`, `outline`; renders as `<a>` or `<span>`                                                |
| Card      | Card                                                                                                                          |
| Dialog    | Full set: trigger, content, header, footer, overlay, close, portal                                                            |
| Select    | Full set with scroll buttons, groups, portal                                                                                  |
| Input     | Single styled input component                                                                                                 |
| Separator | Horizontal/vertical separator                                                                                                 |
| Skeleton  | Loading placeholder primitives                                                                                                |
| Toast     | Toast stack (`ToastProvider` + `toast/ToastItem`)                                                                             |

There is no shadcn `Tabs` / `Table` / `DropdownMenu` wrapper dir: tabs are the custom `primitives/visual/TabStrip.svelte`, tables are feature-specific (e.g. `features/admin/users/UsersTable.svelte`, `features/course/submissions/MatrixTable.svelte`), and the dropdown menu is `features/notification/NotificationDropdown.svelte`.

Custom components in `$lib/components/primitives/ui/`:

| Component     | Purpose                                                              |
| ------------- | -------------------------------------------------------------------- |
| EmptyState    | Icon + title + description + optional CTA for zero-data states       |
| TagInput      | Pill-based tag entry with space/enter to add, backspace to remove    |
| HelpTooltip   | `CircleHelp` icon with Bits UI Tooltip for inline help text          |
| ImageDropZone | Textarea with drag-and-drop + paste image upload, markdown insertion |

Assessment surface components (shared across assignment / exam / contest, see [Assessment Surfaces](#assessment-surfaces)):

| Component      | Location              | Purpose                                                                                                                                                                                                                                     |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AssessmentHero | `features/coursework` | Unified detail-page hero on a `GlassPanel`: type eyebrow + `badges`/`actions` snippets, big title, summary, per-type accent (left stripe + tinted icon badge + corner wash)                                                                 |
| AssessmentRow  | `features/coursework` | Unified list row — standalone glass strip (rounded, `shadow-rest`, `hover-lift`, left accent stripe, `StatusPill` + mono type-eyebrow); the per-type list wrappers (AssignmentCard/ExamRow/ContestPoster/ContestRowPast) now delegate to it |
| StatRail       | `primitives/visual`   | `flex flex-wrap` row of stat tiles shown under the hero                                                                                                                                                                                     |
| StatTile       | `primitives/visual`   | Single glass tile: `label` + `value` snippet (the 4 key facts per assessment type)                                                                                                                                                          |

### Typography

Three font families, all self-hosted via `@fontsource`:

| Token            | Font           | Weights       | Usage                                                             |
| ---------------- | -------------- | ------------- | ----------------------------------------------------------------- |
| `--font-sans`    | Manrope        | 400-700       | All UI text (body, labels, navigation)                            |
| `--font-display` | Fraunces       | 400, 700      | Brand wordmark ("NOJV"), section headings in contest/course views |
| `--font-mono`    | JetBrains Mono | 400, 500, 700 | Code editor, code blocks, sample I/O, character counts            |

Monaco Editor uses `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace` at 14px with no minimap.

### Color System

Teal light/dark theme with manual toggle (persisted in `localStorage` as `nojv-theme`). All colors are defined as CSS custom properties in `apps/web/src/app.css` and consumed through Tailwind tokens (`bg-primary`, `text-success/…`, `var(--chart-3)`). **Never hardcode hex colors in components** — a CI guard (`scripts/check-retired-colors.mjs`) fails the build if the retired burnt-orange/brown palette reappears.

**Light mode:**

- Primary: `#1d8c9c` (teal)
- Muted foreground: `#5f6875`
- Borders: `--border-subtle` = `rgba(20, 24, 31, 0.06)` (dividers / inner lines)
- Chart ramp: `--chart-1` teal `#1d8c9c`, `--chart-2` slate `#4d6f8f`, `--chart-3` green `#2f9d6b`, `--chart-4` amber `#c98a1a`, `--chart-5` sage `#7a8f6d`

**Dark mode:** same token names, brighter values (e.g. `--primary: #36a3b0`).

Semantic status colors are an OKLCH four-tone set: `--success` (green), `--warning` (amber), `--destructive` (red), plus `--muted`. There is no separate per-verdict palette — verdicts map onto these four via `verdict-style.ts` (`verdictTone` / `verdictBadgeVariant`).

Custom tokens beyond the standard set:

- `--panel` / `--color-panel`: card background for surface panels
- `--panel-strong`: higher-opacity variant for nested panels (e.g., locale switcher pill)

**Type-identity accents** (assessment surfaces): three tokens give each assessment kind a stable identity colour — used for the icon badge, left edge stripe, and hero corner wash only. These are **identity**, not status: `StatusPill` and the semantic status tokens above stay state-based. Consumed via `type-accent.ts` (`typeAccentVar(kind)`), not hardcoded in components.

| Token               | Light                    | Dark                     | Kind       |
| ------------------- | ------------------------ | ------------------------ | ---------- |
| `--type-assignment` | `var(--primary)` (teal)  | `var(--primary)` (teal)  | assignment |
| `--type-exam`       | `#5b6fd6` (indigo)       | `#8593e8` (indigo)       | exam       |
| `--type-contest`    | `var(--chart-4)` (amber) | `var(--chart-4)` (amber) | contest    |

Selection highlight uses the primary color at 18% opacity (light) / 25% opacity (dark).

### Semantic Color Conventions

Status meaning maps onto the four design tokens — consume them via Tailwind (`text-success`, `bg-warning/15`, …), never raw Tailwind palette names or hex:

| Semantic Meaning           | Token                |
| -------------------------- | -------------------- |
| Accepted / passed          | `--success`          |
| Wrong / runtime / compile  | `--destructive`      |
| TLE / MLE / system error   | `--warning`          |
| Pending / queued / running | `--muted-foreground` |

Charts read the live token values at runtime via `getComputedStyle` (with teal hex fallbacks for SSR); see the `resolveThemeColors` helper in the analytics/dashboard/admin pages.

### Layout Patterns

**Radii**: Base radius `0.625rem` (10px). Panels and cards use `rounded-[2rem]` or `rounded-[1.5rem]`. Badges and pills use `rounded-full`. Inputs use `rounded-2xl`. Buttons use `rounded-md` (shadcn defaults) or `rounded-full` for nav pills.

**Glassmorphism**: Major surfaces (header, sidebar nav, cards, dropdowns) use `bg-[color:var(--color-panel)] backdrop-blur-sm` for a frosted-glass aesthetic on the gradient background.

**Entrance animations**: Header and navigation bars animate in with `fade-up` (700ms, cubic-bezier easing). Two `@keyframes` are defined: `fade-up` (opacity + translateY) and `fade-in` (opacity only).

**Hover micro-interactions**: Interactive cards and buttons use `hover:-translate-y-0.5` for a subtle lift effect on hover.

**Charts**: ECharts (v6) via a lazy-loaded `EChart.svelte` wrapper. Five chart color tokens (`--chart-1` through `--chart-5`) are defined in oklch color space for both light and dark modes.

### Markdown Rendering

`MarkdownRenderer.svelte` renders problem statements, problem posts, and rich text using:

- `marked` for Markdown-to-HTML conversion
- `marked-katex-extension` for LaTeX math (both inline `$...$` and display `$$...$$`)
- `isomorphic-dompurify` for XSS sanitization (with KaTeX MathML tags/attributes allowlisted)
- `katex/dist/katex.min.css` for math rendering styles

### Internationalization

Paraglide JS (`@inlang/paraglide-js`) with locale-aware routing. Shipped locales: `en` (`baseLocale`, default), `zh-TW`. The header contains a pill-style locale switcher where the active locale gets `bg-primary text-white`.

## Interaction Patterns

### Problem Workspace

The primary problem-solving surface is a resizable split-pane layout (`ProblemWorkspace.svelte`):

- **Left panel**: Tabs -- Description, Submissions, and (practice workspace only) Discussions and Editorials. Default width 42%, draggable resize handle (20%-80% range), keyboard-accessible (`ArrowLeft`/`ArrowRight`).
- **Right panel**: Monaco code editor with language selector, action bar (Run / Submit), and a bottom panel for testcase editing and result viewing.
- Run button: bordered outline style. Submit button: `bg-emerald-600` solid green.
- The bottom panel has its own tab bar for switching between custom testcase input and execution results.
- Submissions tab shows a clickable list; selecting one shows verdict, score, runtime, subtask/case breakdown, and lazy-loaded source code.
- Editorials tab is gated behind having an accepted submission (`hasAc`); the Discussions tab is open to any signed-in user. Both host the full post experience in-panel (list, article with votes/comments, compose).

### Problem Editor (Admin/Teacher)

Five-tab interface (`ProblemTabs.svelte`): Basic Info, Submission, Testcase, Judge, Scoring. Active tab indicated with a bottom-border primary color stripe. Publish button appears in the tab bar when ready (green `rounded-full` pill), disabled with tooltip when validation fails.

### Assessment surfaces

Assignment, exam, and contest pages share one visual grammar (components above):

- **Detail pages** open with an `AssessmentHero` followed by a `StatRail` of `StatTile`s — each type surfaces its most-important 4 facts (assignment: due countdown / progress / score / languages; exam: time / duration / total points / score-or-security; contest: time / participants / scoring / scoreboard).
- **List pages** render items as spaced `AssessmentRow` glass strips inside a `grid gap-2` wrapper (same treatment as the submissions list), replacing the old bespoke `AssignmentCard` / `ExamRow` / `ContestPoster` / `ContestRowPast` looks.
- Every surface carries a **6px (`w-1.5`) left accent stripe** in the type-identity colour (see [Type-identity accents](#color-system)); the `AssessmentHero` eyebrow additionally shows a tinted `TypeIcon` badge (list rows use the stripe + a mono type-eyebrow instead).

### Verdict Display

Verdicts are displayed as colored text labels derived from the verdict enum (`formatVerdictLabel` converts `wrong_answer` to "Wrong Answer"). Case results show as inline pills with checkmark/cross icons. Subtask results use expandable accordion cards with tree-style case listings (`"--"` / `"--"` prefixes).

### Toast Notifications

Fixed bottom-right stack. Three types with distinct border/background colors:

- **success**: emerald border, emerald tint background
- **error**: red border, red tint background
- **info**: blue border, blue tint background

Each toast has a dismiss button (X icon). Toasts are used for SSE-delivered submission verdicts and action confirmations.

### Navigation

- **Header**: Glassmorphism bar with `rounded-[2rem]`, containing the "NOJV" wordmark (Fraunces font), nav pills (rounded-full with border), locale switcher, theme toggle, and user avatar menu.
- **Course management nav**: Same glassmorphism style, pill-based tabs with active state = `bg-primary text-white`.
- **User menu**: Avatar circle (primary background, white initial letter) that opens a dropdown with account link and sign-out (destructive color).

### Status Communication

Assessment/contest states use consistent color coding:

- **Upcoming**: blue
- **Active/Open**: emerald
- **Grace period**: amber
- **Ended/Closed**: muted foreground

Difficulty badges: easy = emerald, medium = amber, hard = red. All use the `bg-{color}-500/15 text-{color}-700 dark:text-{color}-400` pattern.

### Loading States

- Spinner: `animate-spin rounded-full border-2 border-border border-t-foreground` (4x4 or 5x5)
- Disabled buttons: `disabled:opacity-60 disabled:cursor-not-allowed`
- Image upload overlay: semi-transparent background with centered text

### Empty States

`EmptyState.svelte` provides a centered layout with a 14x14 rounded icon container, title, optional description, and optional CTA button (primary color, rounded-full).

## Change Rules

1. **Use existing tokens.** All colors must reference CSS custom properties (`--primary`, `--muted`, etc.) or the semantic Tailwind classes (`bg-primary`, `text-muted-foreground`). Do not introduce raw hex values outside `app.css`.

2. **Follow the semantic color map.** Verdicts, difficulty, and status states have established color conventions (see table above). New status indicators must follow the same pattern (`bg-{color}-500/15 text-{color}-700 dark:text-{color}-400`).

3. **New UI primitives go through Bits UI.** Headless behavior (tooltips, popovers, dialogs, etc.) must use Bits UI, not custom DOM event handling. Wrap Bits UI primitives in styled components under `$lib/components/primitives/ui/`.

4. **Variant-driven components use `tailwind-variants`.** When a component has more than two visual variants, define them with `tv()` and export the type (see `buttonVariants`, `badgeVariants`).

5. **Glassmorphism for major panels.** Cards, headers, navs, and dropdowns use `bg-[color:var(--color-panel)] backdrop-blur-sm`. Do not use opaque solid backgrounds for top-level surfaces. **Border weight follows the shadow:** a panel that also carries an elevation shadow (`shadow-rest` / `shadow-hover` — the `Card` `surface` / `strong` / `elevated` variants and equivalent inline panels) uses the lighter `border-border-subtle` so the shadow does the separating and the outline stays a faint edge; only flat, shadowless surfaces that rely on the outline alone keep the full `border-border`. Internal dividers (`border-t` / `border-b`, table header rows, filter underlines) always use `border-border-subtle`. Floating overlays that sit on unknown backgrounds (toasts, tooltips/popovers) keep `border-border` for edge clarity. Reserve `border-border-strong` for deliberate outline-only treatments.

6. **Both themes must work.** Every color choice must be verified in both light and dark mode. Dark mode uses the `.dark` class on `<html>`.

7. **Fonts are fixed.** Manrope for UI, JetBrains Mono for code, Fraunces for branding only. Do not add new font families without discussion.

8. **Prefer Tailwind utilities over custom CSS.** The only custom CSS is in `app.css` (tokens, keyframes, base layer). Component styles are Tailwind classes applied inline.

9. **Accessibility baselines.** Interactive elements must have `type="button"` (to prevent form submission), `role` and `aria-*` attributes where appropriate (resize handle uses `role="separator"`, dialogs use Bits UI's accessible primitives). Focus styles use the `ring` token.

10. **Animation is subtle.** Entrance animations are 700ms ease-out max. Hover effects are `transition` with `-translate-y-0.5` lift. No gratuitous animation.

## Domain error handling

> Domain queries throw `NotFoundError` (or another `HttpError`) when the caller's intent is "fetch this known entity". They return `T | null` **only** when absence is a valid business state -- e.g. `findActiveSession`, `findByInviteCode`, toggle helpers, "does user X already have assessment Y".

Throwing is the default because every `get*` / `load*` / `fetch*` / `require*` call site either renders an entity or aborts the request, and hand-rolling `if (!x) error(404)` at every boundary is exactly the kind of silent-failure surface this rule exists to eliminate. With one central convention the SvelteKit `handleLoad` wrapper maps domain `HttpError`s to the correct 4xx response, and form actions / API routes can stay focused on business logic.

Legitimate nullable patterns (the only cases where `T | null` is still allowed):

- Toggle helpers where "nothing to flip" is a valid no-op (`toggleUserDisabled`, `toggleAnnouncementPin`, `toggleAnnouncementPublish`).
- "Already in target state" no-ops (`unfreezeContest` returning `null` when the contest is not frozen).
- Unique-key finders whose "not found" case is a normal business outcome (`contestRepo.findByInviteCode` and similar `find*` helpers in `packages/db`).
- Any `find*` helper whose contract is "lookup that may legitimately miss".

Supporting infrastructure:

- [`packages/application/src/shared/require.ts`](../../packages/application/src/shared/require.ts) -- pure "exists-else-throw" helpers (`requireProblem`, `requireContest`, `requireCourse`, `requireUser`, `requireAssessment`).
- [`apps/web/src/lib/server/shared/load-wrapper.ts`](../../apps/web/src/lib/server/shared/load-wrapper.ts) -- `handleLoad()` wraps `+page.server.ts` / `+layout.server.ts` loaders so thrown `HttpError`s turn into the correct SvelteKit `error(status, message)` response.

Example -- a load function composed from a throwing query:

```ts
// apps/web/src/routes/(app)/problems/[id]/+page.server.ts
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { getProblemPageData } from "@nojv/application/problem/queries";

export const load = handleLoad(async ({ params, locals }) => {
  // getProblemPageData throws NotFoundError when the problem is missing;
  // handleLoad converts that into a SvelteKit 404 for us.
  const data = await getProblemPageData(params.id, locals.locale);
  return { problem: data };
});
```

The convention is enforced by [`scripts/check-query-returns.mjs`](../../scripts/check-query-returns.mjs), wired into `pnpm lint` and `pnpm ci:verify`. The guard scans `packages/application/src/**/queries.ts` for exported `get*` / `load*` / `fetch*` / `require*` functions that fall back to `return null`. Escape hatch: annotate the declaration with a leading `// intentional-nullable: <why>` comment. Only use it for cases that match the legitimate patterns listed above.

## Related Docs

- [Frontend Surface](./FRONTEND.md) -- routes, runtime boundaries, auth flow
- [Architecture Overview](./ARCHITECTURE.md) -- system-wide structure
