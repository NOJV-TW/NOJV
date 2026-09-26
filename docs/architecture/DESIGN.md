# Design Rules

Visual system and UI conventions for `apps/web`, plus the domain error-handling convention shared by loaders and application queries. Tokens live in `apps/web/src/app.css`; components consume them through Tailwind classes. Routes, page contracts and accessibility patterns are in [Frontend Surface](FRONTEND.md); layout archetypes and page-level UI decisions are in the [decision log](../decisions/product-ui.md).

## Key code

- `apps/web/src/app.css` — all tokens (`:root`, `.dark`), `@theme inline` mapping, keyframes, base layer, utility classes
- `apps/web/src/lib/components/primitives/ui/` — styled primitives (Bits UI wrappers and custom)
- `apps/web/src/lib/components/primitives/visual/` — `GlassPanel`, `TabStrip`, `FilterTabs`, `StatRail`, `StatTile`, `Countdown`, `Crumbs`, `DifficultyTick`, `DotGrid`, `RankBadge`
- `apps/web/src/lib/components/primitives/layout/` — `PageHeader`, `PageHero`, `PageContainer`, `MarkdownRenderer`, `ThemeToggle`, `Footer`
- `apps/web/src/lib/components/features/coursework/` — assessment surfaces, `StatusPill`, `type-accent.ts`
- `apps/web/src/lib/utils/verdict-style.ts`, `css.ts` (`cn()`), `monaco-themes.ts`
- `apps/web/src/lib/stores/theme.ts`
- `scripts/check-retired-colors.mjs`, `scripts/check-query-returns.mjs`

## Styling stack

- Tailwind CSS 4 (`@tailwindcss/vite`) with `tw-animate-css`. `@theme inline` maps every custom property to a utility (`bg-primary`, `text-success-strong`, `shadow-rest`, `rounded-xl`, `text-title`, `z-[var(--z-toast)]`).
- `tailwind-variants` (`tv()`) for components with variants; export the variant type (`ButtonVariant`, `BadgeVariant`, `CardVariant`).
- `cn()` (`clsx` + `tailwind-merge`) for conditional classes.
- Dark mode: `.dark` class on `<html>` (`@custom-variant dark`). Theme mode is `light` / `dark` / `system` (default `system`), persisted in `localStorage` key `nojv-theme`.

## Tokens

All colors are CSS custom properties in `app.css`, redefined under `.dark`. Components never hardcode hex; `scripts/check-retired-colors.mjs` (`pnpm lint:retired-colors`, part of `pnpm lint:repo` and `pnpm ci:verify`) fails if retired burnt-orange/brown palette values appear in `apps/web/src/**/*.{svelte,ts,css}`.

| Group        | Tokens                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand        | `--primary` teal (`#1d8c9c` light, `#36a3b0` dark), `--primary-foreground`                                                                              |
| Surfaces     | `--background`, `--card`, `--popover`, `--panel`, `--panel-strong`, `--sidebar-*`                                                                       |
| Borders      | `--border`, `--border-subtle` (dividers), `--border-strong` (outline-only treatments)                                                                   |
| Status       | `--success`, `--warning`, `--destructive`, `--info` (OKLCH), each with a `*-strong` text variant (except info); `--muted-foreground`                    |
| Verdict-only | `--verdict-orange` (RE), `--verdict-purple` (MLE), `--verdict-cyan` (pending)                                                                           |
| Charts       | `--chart-1` teal, `--chart-2` slate, `--chart-3` green, `--chart-4` amber, `--chart-5` sage                                                             |
| Type accents | `--type-assignment` (primary), `--type-exam` (indigo), `--type-contest` (`--chart-4`)                                                                   |
| Ranks        | `--rank-gold`, `--rank-silver`, `--rank-bronze`, `--rank-foreground`                                                                                    |
| Navbar       | `--nav-bg`, `--nav-rule`, `--nav-idle`, `--nav-logo`, `--nav-active-bg`, `--nav-active-fg` (always-dark bar)                                            |
| Radius       | `--radius-xs` 6px, `sm` 8, `md` 12 (`--radius`), `lg` 16, `xl` 24, `2xl` 32, `3xl` 40, `full`                                                           |
| Shadow       | `--shadow-rest`, `--shadow-hover`, `--shadow-modal`, `--shadow-focus`, `--shadow-inset-highlight`                                                       |
| Motion       | `--duration-instant` 80ms, `fast` 160, `normal` 240, `slow` 320, `page` 400; `--ease-out-soft`, `--ease-in-soft`, `--ease-in-out-soft`, `--ease-spring` |
| Z-index      | `--z-base` 0, `docked` 10, `sticky` 20, `overlay` 30, `dropdown` 40, `modal` 50, `toast` 60, `tooltip` 70                                               |
| Type scale   | `--text-micro` 11px … `--text-display-lg` 60px (1.25 ratio); `--leading-tight` / `snug` / `normal` / `relaxed`                                          |

- Nested radii follow `inner = outer - padding` (for example `rounded-xl` + `p-4` → inner `rounded-sm`).
- Type-accent tokens are identity, not status; use them only for the icon badge, left stripe and hero wash, via `typeAccentVar(kind)`.
- Charts read live token values with `getComputedStyle` (`resolveThemeColors` in the dashboard, admin and profile pages) with hex fallbacks for SSR.

## Typography

| Token         | Fonts (self-hosted `@fontsource`)           | Use                           |
| ------------- | ------------------------------------------- | ----------------------------- |
| `--font-sans` | Manrope 400–700, Noto Sans TC 400–700 (CJK) | All UI text                   |
| `--font-mono` | JetBrains Mono 400, 500, 700                | Code, sample I/O, tabular ids |

Monaco uses JetBrains Mono at 12px with no minimap (`monaco-themes.ts`); read-only source views share the theme. `code`, `time`, `kbd` and `.font-mono` use tabular numerals.

## Semantic color map

Consume through Tailwind token classes (`text-success`, `bg-warning/15`), never raw Tailwind palette names or hex.

| Meaning                             | Token                                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC                                  | `success`                                                                                                                                                                               |
| WA                                  | `destructive`                                                                                                                                                                           |
| RE / MLE                            | `verdict-orange` / `verdict-purple`                                                                                                                                                     |
| TLE / partial                       | `warning`                                                                                                                                                                               |
| CE                                  | `info`                                                                                                                                                                                  |
| SE                                  | `muted-foreground`                                                                                                                                                                      |
| Pending, queued, compiling, running | `verdict-cyan` (badge pulses)                                                                                                                                                           |
| Difficulty easy / medium / hard     | `success` / `warning` / `destructive` at `/15` bg, `*-strong` text                                                                                                                      |
| Assessment state (`StatusPill`)     | upcoming, scheduled, not started, submitted → `info`; open / in progress (assignment) → `primary`; exam in progress, contest live → `destructive`; draft, closed, ended → neutral muted |

Verdict helpers: `formatVerdictLabel` (short codes AC/WA/TLE/MLE/RE/CE/SE), `verdictTone`, `verdictBadgeVariant`, `difficultyClass` in `verdict-style.ts`. Verdicts always pair color with the short code.

## Components

Bits UI integrations: Dialog, Select, Tabs, Tooltip, Popover, RadioGroup, DropdownMenu.

| Primitive (`primitives/ui/`) | Variants / notes                                                                                                                                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `button`                     | `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`; sizes `default`, `sm`, `lg`, `icon`, `icon-sm`, `icon-lg`; `IconButton`, `LinkButton`                                                                                                                                           |
| `badge`                      | `default`, `secondary`, `destructive`, `outline`, `success`, `warning`, `info`, `muted`, `verdict-*`; sizes `xs`, `sm`, `md`; `<a>` or `<span>`                                                                                                                                                    |
| `card`                       | `surface` (default), `strong`, `flat`, `elevated`, `outline`; sizes `sm`, `md`, `lg`, `hero`; `interactive` lift                                                                                                                                                                                   |
| `dialog`, `select`           | Bits UI wrappers (full part sets, portal)                                                                                                                                                                                                                                                          |
| `tabs`                       | Bits UI Tabs on `GlassPanel`; `visual/TabStrip` is the pill toggle and `visual/FilterTabs` the underline filter bar on list pages                                                                                                                                                                  |
| `input`, `skeleton`, `toast` | `Skeleton` + `SkeletonTable`; `ToastProvider` + `toast/ToastItem`                                                                                                                                                                                                                                  |
| Custom                       | `EmptyState`, `TagSelect`, `HelpTooltip`, `ImageDropZone`, `ConfirmDialog`, `CodeBlock`, `HighlightedCode`, `CopyButton`, `FilterChips`, `FormField`, `FormError`, `Section`, `StatCard`, `ToggleSwitch`, `VerdictBadge`, `MonacoScriptEditor`, `TableTextColumnFilter`, `TableSelectColumnFilter` |

Tables are feature-specific (for example `features/admin/users/UsersTable.svelte`, `features/course/submissions/MatrixTable.svelte`).

## Utility classes (`app.css`)

| Class                           | Effect                                                         |
| ------------------------------- | -------------------------------------------------------------- |
| `.glass`                        | `--panel` background, 12px backdrop blur, `--border` outline   |
| `.hover-lift`                   | 160ms `ease-out-soft`; hover lifts 2px and adds `shadow-hover` |
| `.fade-up`                      | `fade-up` keyframe, 700ms `ease-out-soft`                      |
| `.live-dot`                     | Pulsing primary dot                                            |
| `.verdict-ac/-wa/-tle/-pending` | Token-tinted verdict chips                                     |
| `.eyebrow`                      | Caption size, weight 500, letter-spaced                        |
| `.focus-ring`                   | 3px `ring` at 50% with offset                                  |

Keyframes: `fade-up`, `fade-in`, `pulse-soft`, `shimmer`, `pulse-dot`, `marquee`, `verdict-pop`. Cross-page view transitions use `--duration-fast`; the top bar is excluded. `prefers-reduced-motion` collapses animations and transitions (spinners keep spinning).

## Surfaces and layout

- Page archetypes Index / Hub / Workspace with `PageHeader` / `PageHero`; horizontal padding comes only from the `(app)` layout `<main>` (UI-09).
- Top-level surfaces are glass panels (`GlassPanel`, `Card`, `.glass`), not opaque fills.
- Border weight follows elevation: panels with `shadow-rest` / `shadow-hover` use `border-border-subtle`; flat shadowless surfaces use `border-border`; internal dividers always `border-border-subtle`; floating overlays on unknown backgrounds (toasts, tooltips, popovers) keep `border-border`; `border-border-strong` only for deliberate outline-only treatments.
- Header (`features/layout/Header.svelte`): full-width always-dark `.app-nav` bar on `--nav-*` tokens, icon + label nav items, active item on `--nav-active-bg`; pill locale switcher (active `bg-primary text-primary-foreground`), `ThemeToggle`, avatar `UserMenu`; `MobileNavDrawer` below `lg`.
- Toasts: bottom-right stack (full width on mobile) at `--z-toast`; types `success`, `error`, `warning`, `info`, each with an icon on a `/15` token tint and a dismiss button.
- Loading: `Skeleton` / `SkeletonTable`; buttons show an inline spinner; disabled controls `opacity-50`–`60` and `cursor-not-allowed`.
- `EmptyState`: centered icon tile on `primary/10`, title, optional description and CTA.

### Problem workspace

- Split pane per [Frontend Surface](FRONTEND.md#shared-ui-contracts); solve pages fill the viewport and motion stays restrained (UI-14).
- Action bar: Run is a bordered `rounded-full` pill; Submit is a `rounded-full` `bg-success` pill.
- Problem editor: sticky `EditRail` section nav (Basic, Workspace for multi-file, Testcase, Judge, Reference solution) with the publish checklist and actions in the rail (UI-15).

### Assessment surfaces

Assignment, exam and contest pages share one grammar:

- Detail pages: `AssessmentHero` (`GlassPanel`, type eyebrow with tinted icon badge, title, summary, `badges` / `actions` snippets, corner wash) then a `StatRail` of four `StatTile`s — assignment: due countdown, progress, score, languages; exam: time, duration, total points, score or security; contest: time, participants, scoring, scoreboard.
- List pages: `AssessmentRow` glass strips (`shadow-rest`, `hover-lift`, `StatusPill`, mono type eyebrow) in a `grid gap-2`; `AssignmentCard`, `ExamRow`, `ContestPoster`, `ContestRowPast` delegate to it.
- Every surface carries a 6px (`w-1.5`) left stripe in the type-accent color.
- Manage tabs: see `AssessmentManageTabs` in [Frontend Surface](FRONTEND.md#shared-ui-contracts).

### Markdown and email

- `MarkdownRenderer` renders statements, posts and announcements (`marked`, `marked-katex-extension` for `$…$` / `$$…$$`, `isomorphic-dompurify` with a KaTeX MathML allowlist, `katex.min.css`). Trust and image-proxy rules: SEC-10, SEC-11.
- List previews (home, course overview, admin announcements) show `markdownToPlainText` from `@nojv/core`, never raw Markdown.
- Announcement bodies are edited with `ImageDropZone`, which uploads through `/api/uploads/image` and inserts the image reference.
- Transactional email look is owned by `@nojv/mailer` (`renderEmail`, `renderMarkdownForEmail`; see [its README](../../packages/mailer/README.md)): one white card, zh-TW first then English, inline styles only, light-theme colors as literal hex because clients cannot read CSS variables.

## Change rules

1. Use existing tokens; raw hex only in `app.css` (and email templates). Verify every change in light and dark.
2. Follow the semantic color map for any new status, verdict or difficulty indicator.
3. Headless behavior (dialogs, menus, tooltips, popovers, selects) uses Bits UI, wrapped under `primitives/ui/`; table filters and row editors use Bits UI, not native `<select>` (UI-12).
4. More than two visual variants → `tv()` with an exported variant type.
5. Share a component only when content converges, not just shape (UI-11).
6. Fonts are fixed: Manrope (+ Noto Sans TC) for UI, JetBrains Mono for code.
7. Prefer Tailwind utilities; custom CSS lives only in `app.css`.
8. Interactive elements set `type="button"` unless they submit; custom widgets carry `role` / `aria-*`; focus styles use the `ring` token.
9. Motion is subtle: entrance ≤ 700ms `ease-out-soft`, hover lift 1–2px, respect reduced motion.

## Domain error handling

Application queries throw `NotFoundError` (or another `HttpError`) when the caller expects a known entity. They return `T | null` only when absence is a valid business state. Loaders wrap in `handleLoad()` and API/form handlers in their wrappers, which map `HttpError` to the matching SvelteKit status, so routes never hand-roll `if (!x) error(404)` (see WEB-03).

Allowed nullable patterns:

- Toggle helpers where "nothing to flip" is a no-op (`toggleUserDisabled`, `toggleAnnouncementPin`, `toggleAnnouncementPublish`).
- Already-in-target-state no-ops (`unfreezeContest` returns `null` when not frozen).
- `find*` lookups whose miss is a normal outcome (`contestRepo.findByInviteCode`).

Infrastructure:

- `packages/application/src/shared/require.ts` — exists-else-throw helpers (`requireProblem`, `requireContest`, `requireCourse`, `requireUser`, `requireCourseAssignment`).
- `apps/web/src/lib/server/shared/load-wrapper.ts` — `handleLoad()`; rethrows redirects and sub-500 SvelteKit errors, converts `HttpError` via `classifyRequestError`.

Enforcement: `scripts/check-query-returns.mjs` (`pnpm lint:application-queries`, part of `pnpm lint:repo` and `pnpm ci:verify`) scans `packages/application/src/` for exported `get*` / `load*` / `fetch*` / `require*` functions that `return null`. Escape hatch: a leading `// intentional-nullable: <why>` comment, only for the patterns above.
