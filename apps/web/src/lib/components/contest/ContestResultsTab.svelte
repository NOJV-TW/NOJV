<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ScoreDistributionPanel from "$lib/components/results/ScoreDistributionPanel.svelte";
  import type { ContestResultsData } from "$lib/server/results/contest";

  interface Props {
    data: ContestResultsData;
  }

  let { data }: Props = $props();
</script>

<div class="space-y-5">
  <ScoreDistributionPanel
    buckets={data.buckets}
    submitted={data.submitted}
    classAvg={data.classAvg}
    median={data.median}
    max={data.max}
    min={data.min}
    total={data.total}
    heading={m.results_distributionHeading()}
  />
</div>
