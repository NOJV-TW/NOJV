<script lang="ts" module>
  import type { courseDomain } from "@nojv/application";

  export type AssignmentRow = courseDomain.AssignmentsTopRow;
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import Countdown from "$lib/components/primitives/visual/Countdown.svelte";
  import AssessmentRow from "$lib/components/features/coursework/AssessmentRow.svelte";
  import { diffMs, fmtCountdown } from "$lib/utils/datetime";

  interface Props {
    assignment: AssignmentRow;
    delay?: number;
  }

  let { assignment, delay = 0 }: Props = $props();

  let now = $state(Date.now());
  onMount(() => {
    const id = setInterval(() => {
      now = Date.now();
    }, 30_000);
    return () => clearInterval(id);
  });

  function pillStatus(status: AssignmentRow["status"]): string {
    switch (status) {
      case "upcoming":
        return "not_started";
      case "open":
        return "in_progress";
      case "closed":
        return "closed";
      case "draft":
      default:
        return "not_started";
    }
  }

  const solved = $derived(assignment.myStatus?.solved ?? 0);
  const total = $derived(assignment.myStatus?.total ?? assignment.problemCount);
  const score = $derived(assignment.myStatus?.score ?? 0);
  const totalPoints = $derived(assignment.myStatus?.totalPoints ?? 0);
  const status = $derived(pillStatus(assignment.status));
  const showScore = $derived(
    assignment.classStats === null &&
      assignment.status !== "upcoming" &&
      assignment.status !== "draft",
  );

  const countdown = $derived(
    assignment.closesAt ? fmtCountdown(diffMs(assignment.closesAt, new Date(now))) : null,
  );
  const urgent = $derived(
    !!countdown && !countdown.past && countdown.d < 2 && assignment.status === "open",
  );

  const isManagerRow = $derived(assignment.classStats !== null);
</script>

<AssessmentRow
  href={`/assignments/${assignment.id}`}
  kind="assignment"
  typeLabel={m.assignmentDetail_typeLabel()}
  context={assignment.courseTitle}
  title={assignment.title}
  {status}
  {delay}
>
  {#snippet timing()}
    {#if assignment.closesAt && countdown}
      {#if countdown.past}
        {m.countdown_past()}
      {:else}
        {m.assignmentCard_countdownPrefix()}
        <Countdown iso={assignment.closesAt} isCompact />
        {#if urgent}
          <span style="color: var(--primary);">· {m.assignmentCard_dueSoon()}</span>
        {/if}
      {/if}
    {:else}
      {m.assignmentCard_unscheduled()}
    {/if}
  {/snippet}
  {#snippet foot()}
    {#if isManagerRow && assignment.classStats}
      {assignment.classStats.submittedUsers} / {assignment.classStats.totalStudents}
    {:else if showScore}
      {score} / {totalPoints}
    {:else}
      {solved} / {total}
    {/if}
  {/snippet}
</AssessmentRow>
