<script lang="ts">
  import { page } from "$app/state";
  import ProblemSolveView from "$lib/components/features/problem/views/ProblemSolveView.svelte";

  let { data } = $props();

  let endedKind = $derived(
    page.url.searchParams.get("ended") === "exam" ? ("exam" as const) : undefined
  );
</script>

<ProblemSolveView
  mode="practice"
  allowedLanguages={data.allowedLanguages}
  assessment={data.assignmentProp}
  {endedKind}
  backLink={data.backLink}
  canRejudge={data.canRejudge}
  contestId={data.contestId}
  problem={data.problem}
  submissions={data.submissions}
  testcaseSets={data.testcaseSets}
/>
