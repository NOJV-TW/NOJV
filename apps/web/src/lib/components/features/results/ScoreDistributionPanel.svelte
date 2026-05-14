<script lang="ts" module>
  export interface DistributionBucket {
    label: string;
    count: number;
  }
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import GlassPanel from "$lib/components/primitives/visual/GlassPanel.svelte";

  interface Props {
    buckets: DistributionBucket[];
    submitted: number;
    classAvg?: number | null;
    median?: number | null;
    max?: number | null;
    min?: number | null;
    total?: number | null;
    heading?: string;
    showHeader?: boolean;
    class?: string;
  }

  let {
    buckets,
    submitted,
    classAvg = null,
    median = null,
    max = null,
    min = null,
    total = null,
    heading,
    showHeader = true,
    class: className = ""
  }: Props = $props();

  const headingText = $derived(heading ?? m.results_distributionHeading());

  const bucketColors = [
    "var(--success)",
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-4)",
    "var(--destructive)"
  ];
</script>

<GlassPanel class={`p-5 ${className}`}>
  {#if showHeader && (classAvg !== null || median !== null || max !== null || min !== null || total !== null)}
    <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {#if total !== null}
        <div>
          <div
            class="font-mono text-micro uppercase tracking-wider text-muted-foreground"
          >
            {m.results_submittedLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">
            {submitted}/{total}
          </div>
        </div>
      {/if}
      {#if classAvg !== null}
        <div>
          <div
            class="font-mono text-micro uppercase tracking-wider text-muted-foreground"
          >
            {m.results_avgLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">{classAvg}</div>
        </div>
      {/if}
      {#if median !== null}
        <div>
          <div
            class="font-mono text-micro uppercase tracking-wider text-muted-foreground"
          >
            {m.results_medianLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">{median}</div>
        </div>
      {/if}
      {#if max !== null && min !== null}
        <div>
          <div
            class="font-mono text-micro uppercase tracking-wider text-muted-foreground"
          >
            {m.results_minMaxLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">{max} / {min}</div>
        </div>
      {/if}
    </div>
  {/if}

  <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
    {headingText}
  </div>
  <div class="mt-3 space-y-1.5">
    {#each buckets as b, i (b.label)}
      {@const pct = submitted > 0 ? (b.count / submitted) * 100 : 0}
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
            style:opacity="0.55"
          ></div>
        </div>
        <div class="w-6 text-right font-mono tabular-nums">{b.count}</div>
      </div>
    {/each}
    {#if buckets.length === 0}
      <div class="text-caption text-muted-foreground">
        {m.results_emptyState()}
      </div>
    {/if}
  </div>
</GlassPanel>
