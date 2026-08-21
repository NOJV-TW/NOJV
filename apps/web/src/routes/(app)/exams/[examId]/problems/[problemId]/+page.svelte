<script lang="ts">
  import { goto } from "$app/navigation";
  import ExamTopStrip from "$lib/components/features/problem/layouts/ExamTopStrip.svelte";
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
  <div class="flex h-full flex-col">
    <ExamTopStrip context={data.examContext} />
    <div class="min-h-0 flex-1">
      <ProblemSolveView
        mode="exam"
        backLink={{ href: `/exams/${data.examContext.examId}`, type: "exam" }}
        canRejudge={data.canRejudge}
        problem={data.problem}
        submissions={data.submissions}
        siblingProblems={data.siblingProblems}
        examContext={data.examContext}
        testcaseSets={data.testcaseSets}
      />
    </div>
  </div>
{/if}
