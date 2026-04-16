<script lang="ts">
  import ProblemSolveView from "$lib/components/problem/ProblemSolveView.svelte";

  let { data } = $props();
</script>

<ProblemSolveView
  mode="practice"
  allowedLanguages={data.allowedLanguages}
  assessment={data.assessmentProp}
  backLink={data.backLink}
  contestId={data.contestId}
  problem={data.problem}
  submissions={data.submissions}
  testcaseSets={data.testcaseSets}
/>
