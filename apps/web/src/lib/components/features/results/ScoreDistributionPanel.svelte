<script lang="ts" module>
  export interface DistributionBucket {
    label: string;
    count: number;
  }
</script>

<script lang="ts">
  import { m } from "#lib/paraglide/messages.js";

  interface Props {
    buckets: DistributionBucket[];
  }

  let { buckets }: Props = $props();

  const population = $derived(buckets.reduce((sum, bucket) => sum + bucket.count, 0));
</script>

<section class="px-5 py-4 sm:px-6">
  <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
    <h2 class="text-body font-semibold">{m.results_distributionHeading()}</h2>
    <p class="text-caption text-muted-foreground">
      {m.results_distributionPopulation({ count: population })}
    </p>
  </div>
  <ul
    class="mt-3 grid gap-x-10 gap-y-2 md:grid-flow-col md:grid-cols-2 md:grid-rows-[repeat(var(--rows),auto)]"
    style:--rows={Math.ceil(buckets.length / 2) || 1}
  >
    {#each buckets as b (b.label)}
      {@const pct = population > 0 ? (b.count / population) * 100 : 0}
      <li
        class="grid grid-cols-[minmax(4.5rem,auto)_1fr_auto_3.25rem] items-center gap-2 text-caption tabular-nums"
      >
        <span>{b.label}</span>
        <div class="h-1.5 overflow-hidden rounded-full bg-muted">
          <div class="h-full rounded-full bg-chart-1" style:width={`${pct}%`}></div>
        </div>
        <span class="min-w-10 text-right"
          >{m.results_distributionCount({ count: b.count })}</span
        >
        <span class="text-right text-muted-foreground">{pct.toFixed(1)}%</span>
      </li>
    {/each}
  </ul>
  {#if buckets.length === 0}
    <p class="text-caption text-muted-foreground">{m.results_emptyState()}</p>
  {/if}
</section>
