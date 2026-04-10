<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import type { CourseJoinTokenKind } from "@nojv/core";
  import { Badge } from "$lib/components/ui/badge";

  interface JoinChannel {
    label: string;
    kind: CourseJoinTokenKind;
    token: string;
  }

  interface Props {
    courseSlug: string;
    joinChannels: JoinChannel[];
  }

  let { courseSlug, joinChannels }: Props = $props();
</script>

<section
  class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm shadow-rest"
>
  <div class="flex items-center justify-between gap-4">
    <div>
      <p class="text-caption uppercase tracking-[0.18em] text-muted-foreground">
        {m.courseDetail_joinFlows()}
      </p>
      <h3 class="mt-1 text-title font-semibold">{m.courseDetail_joinFlowsSubtitle()}</h3>
    </div>
    <Badge variant="muted">
      {m.courseDetail_teacherManaged()}
    </Badge>
  </div>
  <div class="mt-5 grid gap-4 md:grid-cols-2">
    {#each joinChannels as channel (`${channel.kind}:${channel.token}`)}
      <article
        class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] px-4 py-4"
      >
        <p class="text-caption uppercase tracking-[0.18em] text-muted-foreground">
          {channel.kind}
        </p>
        <p class="mt-2 text-body-lg font-semibold">{channel.label}</p>
        <p
          class="mt-3 rounded-sm bg-stone-950 px-4 py-3 font-mono text-body-sm tabular-nums text-stone-100"
        >
          {channel.token}
        </p>
        <p class="mt-4 text-body-sm leading-relaxed text-muted-foreground">
          {m.courseDetail_manualInviteHint()}
        </p>
      </article>
    {/each}
  </div>
</section>
