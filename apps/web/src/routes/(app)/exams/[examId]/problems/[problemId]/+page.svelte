<script lang="ts">
  import { goto } from "$app/navigation";
  import ExamTopStrip from "$lib/components/features/problem/layouts/ExamTopStrip.svelte";
  import ProblemSolveView from "$lib/components/features/problem/views/ProblemSolveView.svelte";

  let { data } = $props();

  // Defense-in-depth UX: hooks.server.ts is the real gate; real release
  // runs through the `releaseSession` form action on /exams/[examId].
  // This mirrors the legacy route's pop-state guard so the student
  // cannot browser-back out of exam mode.
  $effect(() => {
    if (typeof window === "undefined") return;

    const examPath = `/exams/${data.examContext.examId}`;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const handlePopState = () => {
      if (!window.location.pathname.startsWith(examPath)) {
        // The first sibling is the natural landing spot after a
        // rogue history pop — `siblingProblems[0]?.href` always points
        // back into the id-unified exam tree.
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

<div class="flex min-h-screen flex-col">
  <ExamTopStrip context={data.examContext} />
  <div class="flex-1">
    <ProblemSolveView
      mode="exam"
      canRejudge={data.canRejudge}
      problem={data.problem}
      submissions={data.submissions}
      siblingProblems={data.siblingProblems}
      examContext={data.examContext}
    />
  </div>
</div>
