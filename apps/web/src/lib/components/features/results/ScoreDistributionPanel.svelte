<script lang="ts" module>
  export interface DistributionBucket {
    label: string;
    count: number;
  }
</script>

<script lang="ts">
  import { m } from "#lib/paraglide/messages.js";
  import GlassPanel from "#lib/components/primitives/visual/GlassPanel.svelte";

  interface Props {
    buckets: DistributionBucket[];
    class?: string;
  }

  let { buckets, class: className = "" }: Props = $props();

  const population = $derived(buckets.reduce((sum, bucket) => sum + bucket.count, 0));
</script>

<GlassPanel class={`p-5 ${className}`}>
  <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
    {m.results_distributionHeading()}
  </div>
  <p class="mt-1 text-caption text-muted-foreground">
    {m.results_distributionPopulation({ count: population })}
  </p>
  <div class="mt-3 space-y-1.5">
    {#each buckets as b (b.label)}
      {@const pct = population > 0 ? (b.count / population) * 100 : 0}
      <div class="flex items-center gap-2 text-caption">
        <div class="w-24 shrink-0 font-mono text-muted-foreground">{b.label}</div>
        <div class="h-4 flex-1 overflow-hidden rounded-sm" style="background: var(--muted);">
          <div class="h-full" style:width={`${pct}%`} style:background="var(--chart-1)"></div>
        </div>
        <div class="w-24 shrink-0 text-right font-mono tabular-nums">
          {m.results_distributionCount({ count: b.count })} · {pct.toFixed(1)}%
        </div>
      </div>
    {/each}
    {#if buckets.length === 0}
      <div class="text-caption text-muted-foreground">
        {m.results_emptyState()}
      </div>
    {/if}
  </div>
</GlassPanel>
