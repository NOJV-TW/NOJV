<script lang="ts">
  import { page } from "$app/state";
  import ProblemSolveView from "$lib/components/features/problem/views/ProblemSolveView.svelte";

  let { data } = $props();

  let endedKind = $derived.by(() => {
    const e = page.url.searchParams.get("ended");
    return e === "exam"
      ? ("exam" as const)
      : e === "assignment"
        ? ("assignment" as const)
        : undefined;
  });
</script>

<ProblemSolveView
  mode="practice"
  allowedLanguages={data.allowedLanguages}
  assessment={data.assignmentProp}
  {endedKind}
  backLink={data.backLink}
  canRejudge={data.canRejudge}
  canViewEditorials={data.canViewEditorials}
  postsEnabled={true}
  contestId={data.contestId}
  problem={data.problem}
  submissions={data.submissions}
  testcaseSets={data.testcaseSets}
/>
