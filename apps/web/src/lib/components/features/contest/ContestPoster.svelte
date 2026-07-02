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
    durationMin: number;
    participants: number;
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
    durationMin,
    participants,
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
  {delay}
>
  {#snippet timing()}
    {isLive ? m.contestPoster_remaining() : m.contestPoster_untilStart()}
    <Countdown iso={isLive ? endsAt : startsAt} isCompact />
  {/snippet}
  {#snippet foot()}
    {m.contestPoster_participantsLabel()}{m.contestPoster_participantsCount({ count: participants })}
  {/snippet}
</AssessmentRow>
