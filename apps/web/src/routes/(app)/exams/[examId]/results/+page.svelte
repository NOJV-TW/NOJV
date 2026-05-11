<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import Crumbs from "$lib/components/coursework/Crumbs.svelte";
  import TypeIcon from "$lib/components/coursework/TypeIcon.svelte";
  import GlassPanel from "$lib/components/coursework/GlassPanel.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const totalMax = $derived(data.problems.reduce((s, p) => s + p.max, 0));

  // Cell colour ramps from green (=max) → muted (=0). Mirrors the
  // design's per-cell tinting which acts as a quick visual scan.
  function cellColor(score: number, max: number): string {
    if (max <= 0) return "var(--muted-foreground)";
    const ratio = score / max;
    if (ratio >= 1) return "oklch(0.45 0.13 160)";
    if (ratio >= 0.5) return "var(--foreground)";
    if (ratio > 0) return "oklch(0.55 0.13 70)";
    return "var(--muted-foreground)";
  }

  const bucketColors = [
    "var(--success)",
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-4)",
    "var(--destructive)"
  ];
</script>

<div class="space-y-5 fade-up pb-20">
  <Crumbs
    items={[
      { label: "exam", href: "/exams" },
      { label: data.examCode, href: `/exams/${data.examId}` },
      { label: m.examResults_crumb() }
    ]}
  />

  <!-- Header band with stats -->
  <div class="glass rounded-2xl p-6 shadow-rest lg:p-7">
    <div class="flex flex-wrap items-center gap-5">
      <div class="flex items-center gap-3">
        <div
          class="rounded-xl p-2.5"
          style="background: color-mix(in oklab, var(--primary) 12%, transparent);"
        >
          <TypeIcon kind="exam" size={20} />
        </div>
        <div>
          <div
            class="font-mono text-micro uppercase tracking-[0.2em] text-muted-foreground"
          >
            {m.examResults_eyebrow({ code: data.examCode })}
          </div>
          <h1 class="text-headline font-semibold tracking-tight">
            {data.examTitle}
          </h1>
        </div>
      </div>
      <div class="ml-auto flex flex-wrap gap-6">
        <div>
          <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.examResults_submittedLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">
            {data.submitted}/{data.total}
          </div>
        </div>
        <div>
          <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.examResults_avgLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">
            {data.classAvg}
          </div>
        </div>
        <div>
          <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.examResults_medianLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">
            {data.median}
          </div>
        </div>
        <div>
          <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.examResults_minMaxLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">
            {data.max} / {data.min}
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="grid gap-5 lg:grid-cols-[1fr_320px]">
    <!-- ICPC-style class table -->
    <GlassPanel class="overflow-hidden">
      <div
        class="flex items-center justify-between border-b border-border-subtle px-5 py-3.5"
      >
        <h2 class="text-title font-semibold">{m.examResults_studentScoresHeading()}</h2>
        <div class="text-caption text-muted-foreground">
          {m.examResults_studentCount({ count: data.rows.length })}
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-caption">
          <thead
            style="background: color-mix(in oklab, var(--muted) 60%, transparent);"
          >
            <tr
              class="font-mono text-micro uppercase tracking-wider text-muted-foreground"
            >
              <th class="w-12 px-4 py-2.5 text-left">#</th>
              <th class="px-3 py-2.5 text-left">{m.examResults_studentColHeader()}</th>
              <th class="px-3 py-2.5 text-left">{m.examResults_handleColHeader()}</th>
              {#each data.problems as p (p.id)}
                <th class="w-14 px-2 py-2.5 text-center">
                  {p.letter}<br />
                  <span class="text-[10px] normal-case opacity-60">/{p.max}</span>
                </th>
              {/each}
              <th class="w-16 px-4 py-2.5 text-right">{m.examResults_totalColHeader()}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.rows as row (row.user)}
              <tr
                class="border-t border-border-subtle"
                style:background={row.me
                  ? "color-mix(in oklab, var(--primary) 8%, transparent)"
                  : undefined}
              >
                <td class="px-4 py-2 font-mono tabular-nums">{row.rank}</td>
                <td class="px-3 py-2 font-medium">
                  {row.user}
                  {#if row.me}
                    <span
                      class="ml-1.5 font-mono text-micro uppercase tracking-wider text-primary"
                      >{m.examResults_youBadge()}</span
                    >
                  {/if}
                </td>
                <td class="px-3 py-2 font-mono text-muted-foreground">{row.sid}</td>
                {#each row.scores as score, i (i)}
                  {@const max = data.problems[i]?.max ?? 0}
                  <td
                    class="px-2 py-2 text-center font-mono tabular-nums"
                    style:color={cellColor(score, max)}
                  >
                    {score}
                  </td>
                {/each}
                <td class="px-4 py-2 text-right font-mono font-semibold tabular-nums">
                  {row.total}
                </td>
              </tr>
            {/each}
            {#if data.rows.length === 0}
              <tr>
                <td
                  colspan={3 + data.problems.length + 1}
                  class="px-4 py-12 text-center text-body-sm text-muted-foreground"
                >
                  {m.examResults_emptyState()}
                </td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
    </GlassPanel>

    <!-- Right column -->
    <div class="space-y-4">
      <GlassPanel class="p-5">
        <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
          {m.examResults_distributionHeading()}
        </div>
        <div class="mt-3 space-y-1.5">
          {#each data.buckets as b, i (b.label)}
            {@const pct = data.submitted > 0 ? (b.count / data.submitted) * 100 : 0}
            <div class="flex items-center gap-2 text-caption">
              <div class="w-14 font-mono text-muted-foreground">{b.label}</div>
              <div
                class="h-4 flex-1 overflow-hidden rounded-sm"
                style="background: var(--muted);"
              >
                <div
                  class="h-full"
                  style:width={`${pct}%`}
                  style:background={bucketColors[i] ?? "var(--muted-foreground)"}
                  style="opacity: 0.55;"
                ></div>
              </div>
              <div class="w-6 text-right font-mono tabular-nums">{b.count}</div>
            </div>
          {/each}
        </div>
      </GlassPanel>

      <!--
        TODO(NOJV): the design's "recent submissions" panel needs a
        domain query (`listRecentExamSubmissions(examId, limit)`) we
        don't have yet. Placeholder text keeps the layout balanced.
      -->
      <GlassPanel class="p-5">
        <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
          {m.examResults_recentSubmissionsHeading()}
        </div>
        <div
          class="mt-3 rounded-lg border border-dashed border-border-subtle px-3 py-6 text-center text-caption text-muted-foreground"
        >
          {m.examResults_comingSoon()}
        </div>
      </GlassPanel>

      <GlassPanel class="p-5">
        <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
          {m.examResults_quickLinksHeading()}
        </div>
        <div class="mt-3 flex flex-col gap-2">
          <a
            href={`/exams/${data.examId}`}
            class="rounded-lg border border-border-subtle px-3 py-2 text-caption font-medium transition-colors hover:border-border"
          >
            {m.examResults_backToExam()}
          </a>
          <a
            href={`/exams/${data.examId}/review`}
            class="rounded-lg border border-border-subtle px-3 py-2 text-caption font-medium transition-colors hover:border-border"
          >
            {m.examResults_viewPersonalReview()}
          </a>
        </div>
      </GlassPanel>
    </div>
  </div>
</div>
