# Next.js to SvelteKit Migration Design

## Decisions

- Framework: Next.js 16 + React 19 → SvelteKit + Svelte 5
- Styling: TailwindCSS 4 (keep)
- i18n: next-intl → svelte-i18n
- Auth: better-auth (keep, switch to SvelteKit adapter)
- Code editor: `monaco-editor` direct API (drop `@monaco-editor/react`)
- Markdown: `react-markdown` → `svelte-markdown` or `mdsvex`
- Charts: echarts direct API (framework-agnostic, no change)
- Math: KaTeX direct API (framework-agnostic, no change)
- Package build: all packages use tsdown
- Config packages: delete, merge to root-level configs

## Monorepo Structure (After)

```
NOJV/
├── apps/
│   ├── web/              # SvelteKit (replaces Next.js)
│   ├── sandbox-runner/   # unchanged
│   └── worker/           # unchanged
├── packages/
│   ├── db/               # + tsdown build
│   ├── domain/           # + tsdown build
│   ├── i18n/             # + tsdown build, svelte-i18n format
│   ├── queue/            # + tsdown build
│   └── ui/               # + tsdown build
├── eslint.config.mjs     # merged from config-eslint
├── tsconfig.base.json    # merged from config-typescript
├── prettier.config.mjs   # already exists, delete config-prettier
└── turbo.json
```

## Migration Phases

### Phase 1: Infrastructure Prep
- Delete config-eslint, config-prettier, config-typescript packages
- Merge configs to root-level files
- Add tsdown build to all packages (db, domain, i18n, queue, ui)
- Update turbo.json pipeline

### Phase 2: SvelteKit Skeleton
- Create `apps/web-svelte` (coexist with Next.js temporarily)
- TailwindCSS 4 setup
- svelte-i18n setup (load en, zh-TW translation files)
- better-auth SvelteKit adapter + hooks
- Base layout (header, nav, auth menu)

### Phase 3: API Routes Migration
- 14 Next.js API routes → SvelteKit `+server.ts`
- Adapt actor-context, api-handler to SvelteKit `RequestEvent`
- Mostly pure TypeScript, low framework coupling

### Phase 4: Page Migration (priority order)
1. Auth pages (signin, signup, complete-profile, admin-signin)
2. Problems pages (list, create, [slug] + Monaco workspace)
3. Courses pages (list, [slug], manage)
4. Assessments pages (assignments, exams)
5. Account, Submissions, other pages

### Phase 5: Cleanup
- Delete `apps/web` (original Next.js)
- Rename `apps/web-svelte` → `apps/web`
- Remove React dependencies
- Update ESLint config (remove React/Next.js rules)

## Tech Mapping

| Next.js | SvelteKit |
|---|---|
| React components (.tsx) | Svelte components (.svelte) |
| App Router pages | +page.svelte |
| layout.tsx | +layout.svelte |
| Server Components | +page.server.ts load functions |
| API route.ts | +server.ts |
| useEffect/useState | $state/$effect (Svelte 5 runes) |
| Context providers | Svelte context (setContext/getContext) |
| next-intl useTranslations | svelte-i18n $t |
| next/navigation | $app/navigation |
| next/image | img + enhanced:img |
