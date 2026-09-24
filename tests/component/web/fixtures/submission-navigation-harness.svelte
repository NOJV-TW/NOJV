<script lang="ts">
  import type { ProblemDetail, ProblemSubmissionEntry } from "$lib/types";
  import ProblemSolveView from "$lib/components/features/problem/views/ProblemSolveView.svelte";
  let {
    load,
    advanced = false,
  }: {
    advanced?: boolean;
    load: () => { submissions: ProblemSubmissionEntry[]; score?: number };
  } = $props();
  let current = $state("a");
  let data = $state<{ submissions: ProblemSubmissionEntry[]; score?: number }>({
    submissions: [],
  });
  export function refresh() {
    data = load();
  }
  export function navigate(id: string) {
    current = id;
    refresh();
  }
  const problem = $derived({
    id: current,
    title: `Problem ${current.toUpperCase()}`,
    type: advanced ? "special_env" : "full_source",
    totalScore: 100,
  } as ProblemDetail);
  const siblings = $derived(
    ["a", "b"].map((id) => ({
      id,
      letter: id.toUpperCase(),
      title: `Problem ${id.toUpperCase()}`,
      maxScore: 100,
      rawMaxScore: 100,
      bestScore: id === "a" ? data.score : undefined,
      isActive: id === current,
      href: `/exams/exam_1/problems/${id}`,
    })),
  );
</script>

<ProblemSolveView
  mode="exam"
  {problem}
  submissions={current === "a" ? data.submissions : []}
  siblingProblems={siblings}
  examContext={{
    examId: "exam_1",
    courseId: "course_1",
    examTitle: "Exam",
    countdownMs: 60000,
    ipAddress: "127.0.0.1",
    userHandle: "student",
  }}
/>
