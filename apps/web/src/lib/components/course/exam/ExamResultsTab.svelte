<script lang="ts" module>
  export interface ResultsProblemCol {
    id: string;
    letter: string;
    title: string;
    max: number;
  }

  export interface ResultsRow {
    rank: number;
    user: string;
    sid: string;
    total: number;
    scores: number[];
    me: boolean;
  }

  export interface ResultsBucket {
    label: string;
    count: number;
  }

  export interface ExamResultsTabData {
    problems: ResultsProblemCol[];
    rows: ResultsRow[];
    classAvg: number;
    median: number;
    max: number;
    min: number;
    submitted: number;
    total: number;
    maxScore: number;
    buckets: ResultsBucket[];
  }
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import GlassPanel from "$lib/components/coursework/GlassPanel.svelte";
  import ScoreDistributionPanel from "$lib/components/results/ScoreDistributionPanel.svelte";

  interface Props {
    data: ExamResultsTabData;
  }

  let { data }: Props = $props();

  function cellColor(score: number, max: number): string {
    if (max <= 0) return "var(--muted-foreground)";
    const ratio = score / max;
    if (ratio >= 1) return "oklch(0.45 0.13 160)";
    if (ratio >= 0.5) return "var(--foreground)";
    if (ratio > 0) return "oklch(0.55 0.13 70)";
    return "var(--muted-foreground)";
  }
</script>

<div class="space-y-5">
  <div class="glass rounded-xl p-4 shadow-rest lg:p-5">
    <div class="flex flex-wrap items-center gap-5">
      <div class="flex gap-6">
        <div>
          <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.results_submittedLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">
            {data.submitted}/{data.total}
          </div>
        </div>
        <div>
          <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.results_avgLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">
            {data.classAvg}<span class="text-body-sm text-muted-foreground"> / {data.maxScore}</span>
          </div>
        </div>
        <div>
          <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.results_medianLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">
            {data.median}<span class="text-body-sm text-muted-foreground"> / {data.maxScore}</span>
          </div>
        </div>
        <div>
          <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.results_minMaxLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">
            {data.max} / {data.min}<span class="text-body-sm text-muted-foreground"> / {data.maxScore}</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="grid gap-5 lg:grid-cols-[1fr_320px]">
    <GlassPanel class="overflow-hidden">
      <div
        class="flex items-center justify-between border-b border-border-subtle px-5 py-3.5"
      >
        <h2 class="text-title font-semibold">{m.results_studentScoresHeading()}</h2>
        <div class="text-caption text-muted-foreground">
          {m.results_studentCount({ count: data.rows.length })}
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
              <th class="px-3 py-2.5 text-left">{m.results_studentColHeader()}</th>
              <th class="px-3 py-2.5 text-left">{m.results_handleColHeader()}</th>
              {#each data.problems as p (p.id)}
                <th class="w-16 px-2 py-2.5 text-center">
                  {p.letter}<br />
                  <span class="text-[10px] normal-case opacity-60">/ {p.max}</span>
                </th>
              {/each}
              <th class="w-20 px-4 py-2.5 text-right">{m.results_totalColHeader()}</th>
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
                      >{m.results_youBadge()}</span
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
                    {score}<span class="text-[10px] opacity-60"> / {max}</span>
                  </td>
                {/each}
                <td class="px-4 py-2 text-right font-mono font-semibold tabular-nums">
                  {row.total}<span class="text-[10px] font-normal text-muted-foreground"> / {data.maxScore}</span>
                </td>
              </tr>
            {/each}
            {#if data.rows.length === 0}
              <tr>
                <td
                  colspan={3 + data.problems.length + 1}
                  class="px-4 py-12 text-center text-body-sm text-muted-foreground"
                >
                  {m.results_emptyState()}
                </td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
    </GlassPanel>

    <div class="space-y-4">
      <ScoreDistributionPanel buckets={data.buckets} submitted={data.submitted} />
    </div>
  </div>
</div>
