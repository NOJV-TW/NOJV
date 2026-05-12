<script lang="ts">
  import ProblemSolveView from "$lib/components/problem/ProblemSolveView.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<ProblemSolveView
  mode="practice"
  allowedLanguages={data.solveProps.allowedLanguages}
  assessment={data.solveProps.assessmentProp}
  endedKind={data.isEnded ? "assignment" : undefined}
  backLink={data.solveProps.backLink}
  canRejudge={data.solveProps.canRejudge}
  contestId={data.solveProps.contestId}
  dailyAttempts={data.dailyAttempts ?? undefined}
  problem={data.solveProps.problem}
  submissions={data.solveProps.submissions}
  testcaseSets={data.solveProps.testcaseSets}
/>
