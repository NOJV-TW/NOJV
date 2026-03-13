<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  interface JoinChannel {
    label: string;
    method: "join_code" | "manual_invite" | "qr_code";
    token: string;
  }

  interface Props {
    courseSlug: string;
    joinChannels: JoinChannel[];
  }

  let { courseSlug, joinChannels }: Props = $props();
</script>

<section
  class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
>
  <div class="flex items-center justify-between gap-4">
    <div>
      <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
        {m.courseDetail_joinFlows()}
      </p>
      <h3 class="mt-1 text-2xl font-semibold">{m.courseDetail_joinFlowsSubtitle()}</h3>
    </div>
    <span
      class="rounded-full border border-border px-3 py-1 text-xs font-medium"
    >
      {m.courseDetail_teacherManaged()}
    </span>
  </div>
  <div class="mt-5 grid gap-4 md:grid-cols-2">
    {#each joinChannels as channel (`${channel.method}:${channel.token}`)}
      <article
        class="rounded-[1.5rem] border border-border bg-[color:var(--color-panel)] px-4 py-4"
      >
        <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
          {channel.method.replaceAll("_", " ")}
        </p>
        <p class="mt-2 text-lg font-semibold">{channel.label}</p>
        <p
          class="mt-3 rounded-2xl bg-stone-950 px-4 py-3 font-mono text-sm text-stone-100"
        >
          {channel.token}
        </p>
        <p class="mt-4 text-sm leading-7 text-muted-foreground">
          {m.courseDetail_manualInviteHint()}
        </p>
      </article>
    {/each}
  </div>
</section>
