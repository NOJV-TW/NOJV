<script lang="ts">
  import AssessmentRow from "$lib/components/features/coursework/AssessmentRow.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { fmtDate } from "$lib/utils/datetime.js";

  interface Props {
    href: string;
    scoringLabel: string;
    title: string;
    startsAt: string;
    participants: number;
    delay?: number;
  }

  let { href, scoringLabel, title, startsAt, participants, delay = 0 }: Props = $props();
</script>

<AssessmentRow
  {href}
  kind="contest"
  typeLabel={m.contestDetail_typeLabel()}
  context={scoringLabel}
  {title}
  status="ended"
  dateIso={startsAt}
  {delay}
>
  {#snippet foot()}
    {m.contestRowPast_meta({ date: fmtDate(startsAt), count: participants })}
  {/snippet}
</AssessmentRow>
