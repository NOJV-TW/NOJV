<script lang="ts">
  import { untrack } from "svelte";
  import { ChevronLeft } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import Crumbs from "$lib/components/coursework/Crumbs.svelte";
  import TypeIcon from "$lib/components/coursework/TypeIcon.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let activeId = $state(untrack(() => data.problems[0]?.id ?? ""));
  let collapsed = $state(false);

  const activeProblem = $derived(
    data.problems.find((p) => p.id === activeId) ?? data.problems[0]
  );

  const pct = $derived(
    data.max > 0 ? Math.round((data.total / data.max) * 100) : 0
  );

  function dotFor(verdict: string): string {
    if (verdict === "AC") return "var(--success)";
    if (verdict === "PAC") return "var(--chart-4)";
    return "oklch(0.55 0.2 27)";
  }

  function verdictBg(verdict: string): string {
    if (verdict === "AC") return "color-mix(in oklab, var(--success) 18%, transparent)";
    if (verdict === "PAC") return "color-mix(in oklab, var(--chart-4) 22%, transparent)";
    return "color-mix(in oklab, var(--destructive) 16%, transparent)";
  }

  function verdictColor(verdict: string): string {
    if (verdict === "AC") return "oklch(0.45 0.13 160)";
    if (verdict === "PAC") return "oklch(0.55 0.13 70)";
    return "oklch(0.55 0.2 27)";
  }

  function verdictLabel(verdict: string): string {
    if (verdict === "PAC") return "Partial";
    return verdict;
  }
</script>

<div class="space-y-5 fade-up pb-20">
  <Crumbs
    items={[
      { label: "exam", href: "/exams" },
      { label: data.examCode, href: `/exams/${data.examId}` },
      { label: m.examReview_crumb() }
    ]}
  />

  <!-- Header band -->
  <div
    class="glass flex flex-wrap items-center gap-6 rounded-2xl p-6 shadow-rest lg:p-7"
  >
    <div class="flex min-w-0 items-center gap-3">
      <div
        class="rounded-xl p-2.5"
        style="background: color-mix(in oklab, var(--primary) 12%, transparent);"
      >
        <TypeIcon kind="exam" size={20} />
      </div>
      <div class="min-w-0">
        <div
          class="font-mono text-micro uppercase tracking-[0.2em] text-muted-foreground"
        >
          {m.examReview_eyebrow({ code: data.examCode })}
        </div>
        <h1
          class="font-display truncate text-headline font-semibold tracking-tight"
        >
          {data.examTitle}
        </h1>
      </div>
    </div>
    <div class="ml-auto flex items-center gap-6">
      <div>
        <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
          {m.examReview_finalScoreLabel()}
        </div>
        <div
          class="font-display mt-0.5 text-display font-bold leading-none tabular-nums"
        >
          {data.total}<span class="text-title text-muted-foreground">
            / {data.max}</span
          >
        </div>
      </div>
      <div>
        <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
          {m.examReview_passRateLabel()}
        </div>
        <div
          class="font-display mt-0.5 text-display font-bold leading-none tabular-nums"
        >
          {pct}<span class="text-title text-muted-foreground">%</span>
        </div>
      </div>
    </div>
  </div>

  <div
    class="grid gap-5"
    style:grid-template-columns={collapsed ? "64px 1fr" : "280px 1fr"}
  >
    <!-- Problem list -->
    <aside class="glass self-start overflow-hidden rounded-2xl shadow-rest">
      <div
        class="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-3"
      >
        {#if !collapsed}
          <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.examReview_problemsHeading({ count: data.problems.length })}
          </div>
        {/if}
        <button
          type="button"
          onclick={() => (collapsed = !collapsed)}
          title={collapsed ? m.examReview_expand() : m.examReview_collapse()}
          class="ml-auto grid size-7 place-items-center rounded-md border border-border-subtle text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          <span
            style:transform={collapsed ? "rotate(180deg)" : "none"}
            class="inline-flex"
          >
            <ChevronLeft class="size-3" />
          </span>
        </button>
      </div>
      <ul class="space-y-1 p-2">
        {#each data.problems as p (p.id)}
          {@const isActive = activeId === p.id}
          <li>
            {#if collapsed}
              <button
                type="button"
                onclick={() => (activeId = p.id)}
                title={`${p.letter}. ${p.title}`}
                class="grid w-full place-items-center rounded-md py-2 transition-colors {isActive
                  ? ''
                  : 'hover:bg-muted'}"
                style:background={isActive ? "var(--panel)" : undefined}
                style:border={isActive
                  ? "1px solid var(--border)"
                  : "1px solid transparent"}
              >
                <span class="font-mono text-caption font-semibold">{p.letter}</span>
                <span
                  class="mt-1 size-1.5 rounded-full"
                  style:background={dotFor(p.verdict)}
                ></span>
              </button>
            {:else}
              <button
                type="button"
                onclick={() => (activeId = p.id)}
                class="w-full rounded-lg px-3 py-2.5 text-left transition-colors {isActive
                  ? ''
                  : 'hover:bg-muted'}"
                style:background={isActive ? "var(--panel)" : undefined}
                style:border={isActive ? "1px solid var(--border)" : undefined}
              >
                <div class="flex items-center gap-2">
                  <span
                    class="font-mono text-caption font-semibold text-muted-foreground"
                    >{p.letter}.</span
                  >
                  <span class="flex-1 truncate text-body-sm">{p.title}</span>
                  <span
                    class="size-2 rounded-full"
                    style:background={dotFor(p.verdict)}
                  ></span>
                </div>
                <div
                  class="mt-1 flex items-center justify-between font-mono text-micro"
                >
                  <span class="text-muted-foreground">{p.verdict}</span>
                  <span class="tabular-nums">{p.score}/{p.max}</span>
                </div>
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    </aside>

    <!-- Problem detail -->
    {#if activeProblem}
      <section class="glass rounded-2xl p-7 shadow-rest">
        <div class="flex flex-wrap items-baseline gap-3">
          <span class="font-mono text-title text-muted-foreground"
            >{activeProblem.letter}.</span
          >
          <h2 class="font-display text-title-lg font-semibold">{activeProblem.title}</h2>
          <span
            class="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-caption uppercase tracking-wider"
            style:background={verdictBg(activeProblem.verdict)}
            style:color={verdictColor(activeProblem.verdict)}
          >
            {verdictLabel(activeProblem.verdict)}
          </span>
        </div>

        <div
          class="mt-4 grid grid-cols-2 gap-3 border-b border-t border-border-subtle py-4 sm:grid-cols-4"
        >
          <div>
            <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
              {m.examReview_scoreLabel()}
            </div>
            <div class="font-display mt-1 text-title font-semibold tabular-nums">
              {activeProblem.score} / {activeProblem.max}
            </div>
          </div>
          <div>
            <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
              {m.examReview_submissionsLabel()}
            </div>
            <div class="font-display mt-1 text-title font-semibold tabular-nums">
              {activeProblem.tries}
            </div>
          </div>
          <div>
            <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
              {m.examReview_languageLabel()}
            </div>
            <div class="font-display mt-1 text-title font-semibold">—</div>
          </div>
          <div>
            <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
              {m.examReview_percentLabel()}
            </div>
            <div class="font-display mt-1 text-title font-semibold tabular-nums">
              {activeProblem.max > 0
                ? Math.round((activeProblem.score / activeProblem.max) * 100)
                : 0}%
            </div>
          </div>
        </div>

        <!--
          TODO(NOJV): subtask grid + final source code require a
          per-student-per-problem submission detail query that doesn't
          yet exist. The matrix query the loader uses only exposes the
          aggregate best score. Drop in the breakdown once the domain
          ships `getExamStudentReview()`.
        -->
        <div class="mt-5">
          <div class="mb-2 font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.examReview_subtasksHeading()}
          </div>
          <div
            class="rounded-lg border border-dashed border-border-subtle px-4 py-6 text-center text-body-sm text-muted-foreground"
          >
            {m.examReview_subtasksPlaceholder()}
          </div>
        </div>

        <div class="mt-5">
          <div class="mb-2 font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.examReview_submissionHeading()}
          </div>
          <div
            class="rounded-lg border border-dashed border-border-subtle px-4 py-6 text-center text-body-sm text-muted-foreground"
          >
            {m.examReview_submissionPlaceholder({ letter: activeProblem.letter, title: activeProblem.title })}
          </div>
        </div>
      </section>
    {/if}
  </div>
</div>
