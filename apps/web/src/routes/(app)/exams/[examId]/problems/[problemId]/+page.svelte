<script lang="ts">
  import { goto } from "$app/navigation";
  import ProblemSolveView from "$lib/components/features/problem/views/ProblemSolveView.svelte";

  let { data } = $props();

  $effect(() => {
    if (typeof window === "undefined") return;
    if (data.mode === "preview") return;

    const examPath = `/exams/${data.examContext.examId}`;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const handlePopState = () => {
      if (!window.location.pathname.startsWith(examPath)) {
        const fallback =
          data.siblingProblems[0]?.href ?? `${examPath}/problems/${data.problem.id}`;
        goto(fallback, { replaceState: true });
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  });
</script>

{#if data.mode === "preview"}
  <ProblemSolveView
    mode="practice"
    allowedLanguages={data.solveProps.allowedLanguages}
    backLink={data.solveProps.backLink}
    canRejudge={data.solveProps.canRejudge}
    problem={data.solveProps.problem}
    submissions={data.solveProps.submissions}
    testcaseSets={data.solveProps.testcaseSets}
  />
{:else}
  <ProblemSolveView
    mode="exam"
    backLink={{ href: `/exams/${data.examContext.examId}`, type: "exam" }}
    canRejudge={data.canRejudge}
    problem={data.problem}
    submissions={data.submissions}
    siblingProblems={data.siblingProblems}
    examContext={data.examContext}
    workspaceTimer={{
      type: "exam",
      examId: data.examContext.examId,
      endsAt: data.examContext.endsAt,
    }}
    testcaseSets={data.testcaseSets}
  />
{/if}
