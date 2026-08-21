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

  function statusKind(status: AssignmentRow["status"]): string {
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

  const score = $derived(assignment.myStatus?.score ?? 0);
  const totalPoints = $derived(assignment.myStatus?.totalPoints ?? assignment.totalPoints);
  const status = $derived(statusKind(assignment.status));
  const countdownIso = $derived(
    assignment.status === "upcoming" ? assignment.opensAt : assignment.closesAt,
  );

  const countdown = $derived(
    countdownIso ? fmtCountdown(diffMs(countdownIso, new Date(now))) : null,
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
  startsAt={assignment.opensAt}
  endsAt={assignment.closesAt}
  {delay}
>
  {#snippet timing()}
    {#if countdownIso && countdown && !countdown.past && assignment.status !== "draft"}
      <Countdown iso={countdownIso} isCompact />
    {/if}
  {/snippet}
  {#snippet foot()}
    {#if assignment.myStatus}
      {#if totalPoints != null}{score} / {totalPoints}{:else}{score}{/if}
    {:else if isManagerRow && assignment.classStats}
      {#if totalPoints != null}{assignment.classStats.avgScore} / {totalPoints}{:else}{assignment
          .classStats.avgScore}{/if}
    {:else}
      {totalPoints != null ? `— / ${totalPoints}` : "—"}
    {/if}
  {/snippet}
</AssessmentRow>
