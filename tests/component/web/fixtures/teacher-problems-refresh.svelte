<script lang="ts">
  import type { TeacherProblemSnapshot } from "./teacher-refresh-data";
  import { untrack } from "svelte";
  import AssignmentProblemsTab from "$lib/components/features/course/assignment/AssignmentProblemsTab.svelte";
  import ExamProblemsTab from "$lib/components/features/course/exam/ExamProblemsTab.svelte";
  let { kind, initial }: { kind: "assignment" | "exam"; initial: TeacherProblemSnapshot } =
    $props();
  let snapshot = $state(untrack(() => initial));
  export function refresh(next: TeacherProblemSnapshot) {
    snapshot = next;
  }
  const rows = $derived(
    snapshot.problems.map((problem, index) => ({
      ...problem,
      problemId: problem.id,
      difficulty: "easy" as const,
      displayId: index + 1,
      rawMaxScore: 100,
      ordinal: index + 1,
      letter: String.fromCharCode(65 + index),
      myStatus: null,
      viewerState: null,
    })),
  );
  const detail = $derived({
    id: snapshot.id,
    courseId: "course",
    title: "Exam",
    summary: "",
    startsAt: "2026-09-21T00:00:00Z",
    endsAt: "2026-09-21T02:00:00Z",
    dueAt: null,
    latePenalty: null,
    status: "draft" as const,
    scoringMode: "point_sum" as const,
    scoreboardMode: "hidden" as const,
    pageLockEnabled: false,
    ipBindingEnabled: false,
    ipWhitelistEnabled: false,
    ipWhitelistCount: 0,
    ipViolationMode: "block" as const,
    problems: rows,
    registeredCount: 0,
    totalStudents: 0,
    viewerScore: null,
    totalPoints: snapshot.totalPoints,
    gradingRevision: snapshot.gradingRevision,
    gradingPending: false,
    roster: null,
    manager: null,
  });
</script>

{#if kind === "assignment"}
  <AssignmentProblemsTab
    assignmentId={snapshot.id}
    problems={rows}
    totalPoints={snapshot.totalPoints}
    gradingRevision={snapshot.gradingRevision}
    canEdit
  />
{:else}
  <ExamProblemsTab {detail} canEdit />
{/if}
