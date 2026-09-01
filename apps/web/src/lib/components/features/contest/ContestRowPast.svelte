<script lang="ts">
  import AssessmentRow from "$lib/components/features/coursework/AssessmentRow.svelte";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    href: string;
    scoringLabel: string;
    title: string;
    startsAt: string;
    endsAt: string;
    score: number | null;
    totalPoints: number;
    showStatusIcon?: boolean;
    delay?: number;
  }

  let {
    href,
    scoringLabel,
    title,
    startsAt,
    endsAt,
    score,
    totalPoints,
    showStatusIcon = true,
    delay = 0,
  }: Props = $props();
</script>

<AssessmentRow
  {href}
  kind="contest"
  typeLabel={m.contestDetail_typeLabel()}
  context={scoringLabel}
  {title}
  status="ended"
  {startsAt}
  {endsAt}
  {showStatusIcon}
  {delay}
>
  {#snippet foot()}
    {score == null ? `— / ${totalPoints}` : `${score} / ${totalPoints}`}
  {/snippet}
</AssessmentRow>
