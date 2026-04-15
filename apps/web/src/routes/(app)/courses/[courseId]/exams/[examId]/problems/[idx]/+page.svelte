<script lang="ts">
  import { goto } from "$app/navigation";
  import ExamTopStrip from "$lib/components/problem/ExamTopStrip.svelte";
  import ProblemSolveView from "$lib/components/problem/ProblemSolveView.svelte";

  let { data } = $props();

  /**
   * Client-side exam confinement handlers. The server-side
   * hooks.server.ts exam-lock hook (Task 4.1) is the authoritative
   * gate; these are defense-in-depth UX affordances so an active
   * exam participant cannot accidentally navigate away via browser
   * back button or close the tab without a warning.
   *
   * Real release only happens through the /api/exam-session/end
   * endpoint, triggered by the in-page "Submit & end exam" button.
   */
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
