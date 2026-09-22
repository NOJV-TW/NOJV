<script lang="ts">
  import type { ActivityProblem } from "@nojv/core";
  import ActivityWeights from "$lib/components/features/course/ActivityWeights.svelte";

  let { onTotal }: { onTotal: (total: number) => void } = $props();
  let totalPoints = $state(100);
  let problems = $state<ActivityProblem[]>([]);
  $effect(() => onTotal(totalPoints));

  export function add(problemId: string) {
    problems = [...problems, { problemId, points: 100 }];
  }
</script>

<ActivityWeights bind:totalPoints {problems} onchange={(rows) => (problems = rows)} />
