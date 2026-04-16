<script lang="ts">
  import ProblemSolveView from "$lib/components/problem/ProblemSolveView.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<ProblemSolveView
  mode="practice"
  allowedLanguages={data.solveProps.allowedLanguages}
  assessment={data.solveProps.assessmentProp}
  backLink={data.solveProps.backLink}
  contestId={data.solveProps.contestId}
  problem={data.solveProps.problem}
  submissions={data.solveProps.submissions}
  testcaseSets={data.solveProps.testcaseSets}
/>
