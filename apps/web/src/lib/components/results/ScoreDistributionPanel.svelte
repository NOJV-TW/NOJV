<script lang="ts" module>
  export interface ScoreBucket {
    label: string;
    count: number;
  }
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import GlassPanel from "$lib/components/coursework/GlassPanel.svelte";

  interface Props {
    buckets: ScoreBucket[];
    submitted: number;
    class?: string;
  }

  let { buckets, submitted, class: className }: Props = $props();

  // Diverging colour ramp green → red for high → low.
  const bucketColors = [
    "var(--success)",
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-4)",
    "var(--destructive)",
  ];
</script>

<GlassPanel class={`p-5 ${className ?? ""}`}>
  <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
    {m.results_distributionHeading()}
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
  </div>
</GlassPanel>
