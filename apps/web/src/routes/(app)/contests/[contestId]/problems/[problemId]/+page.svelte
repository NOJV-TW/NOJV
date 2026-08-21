<script lang="ts">
  import ProblemSolveView from "$lib/components/features/problem/views/ProblemSolveView.svelte";

  let { data } = $props();
</script>

<ProblemSolveView
  mode="practice"
  allowedLanguages={data.contestData.allowedLanguages}
  backLink={{ href: `/contests/${data.contestId}`, type: "contest" }}
  canRejudge={data.canRejudge}
  contestId={data.contestId}
  problem={data.problem}
  siblingProblems={data.siblingProblems}
  submissions={data.submissions}
  workspaceTimer={{ type: "contest", endsAt: data.contestData.endsAt }}
  testcaseSets={data.testcaseSets}
/>
