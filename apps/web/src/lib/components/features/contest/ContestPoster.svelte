<script lang="ts">
  import Countdown from "$lib/components/primitives/visual/Countdown.svelte";
  import AssessmentRow from "$lib/components/features/coursework/AssessmentRow.svelte";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    href: string;
    scoringLabel: string;
    status: "upcoming" | "live" | "ended";
    title: string;
    summary: string;
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
    status,
    title,
    summary,
    startsAt,
    endsAt,
    score,
    totalPoints,
    showStatusIcon = true,
    delay = 0,
  }: Props = $props();

  const isLive = $derived(status === "live");
</script>

<AssessmentRow
  {href}
  kind="contest"
  typeLabel={m.contestDetail_typeLabel()}
  context={scoringLabel}
  {title}
  {status}
  {startsAt}
  {endsAt}
  {showStatusIcon}
  {delay}
>
  {#snippet timing()}
    <Countdown iso={isLive ? endsAt : startsAt} isCompact />
  {/snippet}
  {#snippet foot()}
    {score == null ? `— / ${totalPoints}` : `${score} / ${totalPoints}`}
  {/snippet}
</AssessmentRow>
