<script lang="ts">
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

<a
  {href}
  class="group glass hover-lift rounded-lg shadow-rest fade-up block px-5 py-4"
  style="animation-delay: {delay}ms;"
>
  <div class="flex items-center gap-4">
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline gap-2">
        <h3 class="text-body-lg font-semibold truncate">{title}</h3>
        <span class="text-caption text-muted-foreground">{scoringLabel}</span>
      </div>
      <div class="text-caption text-muted-foreground">
        {m.contestRowPast_meta({ date: fmtDate(startsAt), count: participants })}
      </div>
    </div>
    <span
      class="text-caption font-medium text-muted-foreground transition-colors group-hover:text-foreground"
    >
      →
    </span>
  </div>
</a>
