<script lang="ts">
  import { goto } from "$app/navigation";
  import ExamTopStrip from "$lib/components/problem/ExamTopStrip.svelte";
  import ProblemSolveView from "$lib/components/problem/ProblemSolveView.svelte";

  let { data } = $props();

  // Defense-in-depth UX: hooks.server.ts is the real gate; real release runs through /api/exam-session/end.
  $effect(() => {
    if (typeof window === "undefined") return;

    const examPath = `/courses/${data.examContext.courseId}/exams/${data.examContext.examId}`;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const handlePopState = () => {
      if (!window.location.pathname.startsWith(examPath)) {
        goto(`${examPath}/problems/0`, { replaceState: true });
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

<div class="flex min-h-screen flex-col">
  <ExamTopStrip context={data.examContext} />
  <div class="flex-1">
    <ProblemSolveView
      mode="exam"
      problem={data.problem}
      submissions={data.submissions}
      siblingProblems={data.siblingProblems}
      examContext={data.examContext}
    />
  </div>
</div>
