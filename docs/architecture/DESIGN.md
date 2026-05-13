# Design

Design guidance matters in this repository because NOJV is a tool that students and teachers use under time pressure -- during exams, contests, and assignment deadlines. Clarity, speed, and trust in the interface directly affect whether users can focus on problem-solving rather than fighting the UI.

## Implemented Design System

### CSS Framework

Tailwind CSS 4 with `tw-animate-css` for animation utilities. Components use `tailwind-variants` (`tv()`) for variant-driven styling and `tailwind-merge` via the `cn()` utility from `$lib/utils.ts` for conditional class merging. The `clsx` library handles class composition before merge.

The `@theme inline` block in `app.css` maps CSS custom properties to Tailwind color tokens (`--color-primary`, `--color-muted`, etc.) so all design tokens are usable as Tailwind classes (`bg-primary`, `text-muted-foreground`).

### Component Library

Bits UI (headless Svelte components, similar to Radix) provides accessible primitives. Shipped Bits UI integrations: Tooltip, Dialog, DropdownMenu, Select, Tabs. These are wrapped in styled components under `$lib/components/ui/`.

shadcn-svelte-style components in `$lib/components/ui/`:

| Component    | Variants / Notes                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Button       | `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`; sizes: `default`, `sm`, `lg`, `icon`, `icon-sm`, `icon-lg` |
| Badge        | `default`, `secondary`, `destructive`, `outline`; renders as `<a>` or `<span>`                                                |
| Card         | Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction                                             |
| Dialog       | Full set: trigger, content, header, footer, overlay, close, portal                                                            |
| DropdownMenu | Full set including sub-menus, checkbox items, radio groups, shortcuts                                                         |
| Select       | Full set with scroll buttons, groups, portal                                                                                  |
| Tabs         | Tabs, TabsList, TabsTrigger, TabsContent                                                                                      |
| Table        | Table, TableHeader, TableHead, TableBody, TableRow, TableCell, TableFooter, TableCaption                                      |
| Input        | Single styled input component                                                                                                 |
| Separator    | Horizontal/vertical separator                                                                                                 |

Custom components in `$lib/components/ui/`:

| Component        | Purpose                                                              |
| ---------------- | -------------------------------------------------------------------- |
| EmptyState       | Icon + title + description + optional CTA for zero-data states       |
| ToastContainer   | Fixed bottom-right toast stack with success/error/info type styling  |
| TagInput         | Pill-based tag entry with space/enter to add, backspace to remove    |
| HelpTooltip      | `CircleHelp` icon with Bits UI Tooltip for inline help text          |
| ImageDropZone    | Textarea with drag-and-drop + paste image upload, markdown insertion |
| SystemTextToggle | Admin-side zh/en toggle with localStorage persistence                |

### Typography

Three font families, all self-hosted via `@fontsource`:

| Token            | Font           | Weights       | Usage                                                             |
| ---------------- | -------------- | ------------- | ----------------------------------------------------------------- |
| `--font-sans`    | Manrope        | 400-700       | All UI text (body, labels, navigation)                            |
| `--font-display` | Fraunces       | 400, 700      | Brand wordmark ("NOJV"), section headings in contest/course views |
| `--font-mono`    | JetBrains Mono | 400, 500, 700 | Code editor, code blocks, sample I/O, character counts            |

Monaco Editor uses `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace` at 14px with no minimap.

### Color System

Warm-toned light/dark theme with manual toggle (persisted in `localStorage` as `nojv-theme`). A 200ms CSS transition on `background-color`, `border-color`, and `color` smooths the switch (applied via `.theme-transition` class).

**Light mode** -- warm cream base:

- Background: `#f7f1e8` (cream) with subtle radial gradients (burnt orange top-left, blue-grey top-right)
- Primary: `#c4682d` (burnt orange)
- Foreground: `#1f1916` (near-black warm)
- Cards/panels: `rgba(255, 250, 244, 0.82)` (frosted glass effect with `backdrop-blur-sm`)
- Borders: `rgba(79, 52, 35, 0.14)` (translucent warm brown)

**Dark mode** -- deep warm brown base:

- Background: `#1a1412` with matching muted radial gradients
- Primary: `#d4834a` (lighter burnt orange for contrast)
- Foreground: `#f5ede4` (warm white)
- Cards/panels: `rgba(42, 32, 26, 0.82)`
- Borders: `rgba(255, 250, 244, 0.1)`

Custom tokens beyond the standard set:

- `--panel`: translucent card background for glassmorphism surfaces
- `--panel-strong`: higher-opacity variant for nested panels (e.g., locale switcher pill)

Selection highlight uses the primary color at 18% opacity (light) / 25% opacity (dark).

### Semantic Color Conventions

These color assignments are used consistently across the entire codebase:

| Semantic Meaning  | Color Pattern                                             |
| ----------------- | --------------------------------------------------------- |
| Accepted / passed | `emerald-500/600` foreground, `emerald-500/15` background |
| Wrong / failed    | `red-500/600` foreground, `red-500/15` background         |
| Warning / TLE     | `amber-500/600` foreground, `amber-500/15` background     |
| MLE               | `orange-500/600` foreground, `orange-500/15` background   |
| Runtime error     | `purple-500/600` foreground, `purple-500/15` background   |
| Info / queued     | `blue-500/600` foreground, `blue-500/15` background       |
| Checker judge     | `violet-500/15` background, `violet-600/700` foreground   |
| Interactive judge | `sky-500/15` background, `sky-600/700` foreground         |

All semantic colors use the `dark:text-{color}-400` pattern for dark mode contrast.

### Layout Patterns

**Radii**: Base radius `0.625rem` (10px). Panels and cards use `rounded-[2rem]` or `rounded-[1.5rem]`. Badges and pills use `rounded-full`. Inputs use `rounded-2xl`. Buttons use `rounded-md` (shadcn defaults) or `rounded-full` for nav pills.

**Glassmorphism**: Major surfaces (header, sidebar nav, cards, dropdowns) use `bg-[color:var(--color-panel)] backdrop-blur-sm` for a frosted-glass aesthetic on the gradient background.

**Entrance animations**: Header and navigation bars animate in with `fade-up` (700ms, cubic-bezier easing). Two `@keyframes` are defined: `fade-up` (opacity + translateY) and `fade-in` (opacity only).

**Hover micro-interactions**: Interactive cards and buttons use `hover:-translate-y-0.5` for a subtle lift effect on hover.

**Charts**: ECharts (v6) via a lazy-loaded `EChart.svelte` wrapper. Five chart color tokens (`--chart-1` through `--chart-5`) are defined in oklch color space for both light and dark modes.

### Markdown Rendering

`MarkdownRenderer.svelte` renders problem statements, editorials, and rich text using:

- `marked` for Markdown-to-HTML conversion
- `marked-katex-extension` for LaTeX math (both inline `$...$` and display `$$...$$`)
- `isomorphic-dompurify` for XSS sanitization (with KaTeX MathML tags/attributes allowlisted)
- `katex/dist/katex.min.css` for math rendering styles

### Internationalization

Paraglide JS (`@inlang/paraglide-js`) with locale-aware routing. Shipped locales: `en`, `zh-TW`. The header contains a pill-style locale switcher where the active locale gets `bg-primary text-white`.

## Interaction Patterns

### Problem Workspace

The primary problem-solving surface is a resizable split-pane layout (`Workspace.svelte`):

- **Left panel**: Three tabs -- Description, Submissions, Editorials. Default width 42%, draggable resize handle (20%-80% range), keyboard-accessible (`ArrowLeft`/`ArrowRight`).
- **Right panel**: Monaco code editor with language selector, action bar (Run / Submit), and a bottom panel for testcase editing and result viewing.
- Run button: bordered outline style. Submit button: `bg-emerald-600` solid green.
- The bottom panel has its own tab bar for switching between custom testcase input and execution results.
- Submissions tab shows a clickable list; selecting one shows verdict, score, runtime, subtask/case breakdown, and lazy-loaded source code.
- Editorials tab is gated behind having an accepted submission (`hasAc`).

### Problem Editor (Admin/Teacher)

Five-tab interface (`ProblemTabs.svelte`): Basic Info, Submission, Testcase, Judge, Scoring. Active tab indicated with a bottom-border primary color stripe. Publish button appears in the tab bar when ready (green `rounded-full` pill), disabled with tooltip when validation fails.

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

3. **New UI primitives go through Bits UI.** Headless behavior (tooltips, popovers, dialogs, etc.) must use Bits UI, not custom DOM event handling. Wrap Bits UI primitives in styled components under `$lib/components/ui/`.

4. **Variant-driven components use `tailwind-variants`.** When a component has more than two visual variants, define them with `tv()` and export the type (see `buttonVariants`, `badgeVariants`).

5. **Glassmorphism for major panels.** Cards, headers, navs, and dropdowns use `bg-[color:var(--color-panel)] backdrop-blur-sm` with `border border-border`. Do not use opaque solid backgrounds for top-level surfaces.

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

- [`packages/domain/src/shared/require.ts`](../packages/domain/src/shared/require.ts) -- pure "exists-else-throw" helpers (`requireProblem`, `requireContest`, `requireCourse`, `requireUser`, `requireCourseAssessment`).
- [`apps/web/src/lib/server/shared/load-wrapper.ts`](../apps/web/src/lib/server/shared/load-wrapper.ts) -- `handleLoad()` wraps `+page.server.ts` / `+layout.server.ts` loaders so thrown `HttpError`s turn into the correct SvelteKit `error(status, message)` response.

Example -- a load function composed from a throwing query:

```ts
// apps/web/src/routes/(app)/problems/[id]/+page.server.ts
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { getProblemPageData } from "@nojv/domain/problem/queries";

export const load = handleLoad(async ({ params, locals }) => {
  // getProblemPageData throws NotFoundError when the problem is missing;
  // handleLoad converts that into a SvelteKit 404 for us.
  const data = await getProblemPageData(params.id, locals.locale);
  return { problem: data };
});
```

The convention is enforced by [`scripts/check-query-returns.mjs`](../../scripts/check-query-returns.mjs), wired into `pnpm lint` and `pnpm ci:verify`. The guard scans `packages/domain/src/**/queries.ts` for exported `get*` / `load*` / `fetch*` / `require*` functions that fall back to `return null`. Escape hatch: annotate the declaration with a leading `// intentional-nullable: <why>` comment. Only use it for cases that match the legitimate patterns listed above.

## Related Docs

- [Frontend Surface](./FRONTEND.md) -- routes, runtime boundaries, auth flow
- [Architecture Overview](./ARCHITECTURE.md) -- system-wide structure
