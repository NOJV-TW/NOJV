<script lang="ts">
  import type { ActivityProblem } from "@nojv/core";
  import ActivityWeights from "$lib/components/features/course/ActivityWeights.svelte";

  let problems = $state<ActivityProblem[]>([]);

  export function add(problemId: string) {
    problems = [...problems, { problemId, points: 100 }];
  }
  export function rows(): ActivityProblem[] {
    return problems;
  }
</script>

<ActivityWeights {problems} onchange={(next) => (problems = next)} />
