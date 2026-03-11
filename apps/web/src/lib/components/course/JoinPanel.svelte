<script lang="ts">
  import { t } from "svelte-i18n";

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
  class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
>
  <div class="flex items-center justify-between gap-4">
    <div>
      <p class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
        {$t("courseDetail.joinFlows")}
      </p>
      <h3 class="mt-1 text-2xl font-semibold">{$t("courseDetail.joinFlowsSubtitle")}</h3>
    </div>
    <span
      class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
    >
      {$t("courseDetail.teacherManaged")}
    </span>
  </div>
  <div class="mt-5 grid gap-4 md:grid-cols-2">
    {#each joinChannels as channel (`${channel.method}:${channel.token}`)}
      <article
        class="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
      >
        <p class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
          {channel.method.replaceAll("_", " ")}
        </p>
        <p class="mt-2 text-lg font-semibold">{channel.label}</p>
        <p
          class="mt-3 rounded-2xl bg-stone-950 px-3 py-2 font-mono text-sm text-stone-100"
        >
          {channel.token}
        </p>
        {#if channel.method !== "qr_code"}
          <p class="mt-4 text-sm leading-7 text-[color:var(--color-muted)]">
            {$t("courseDetail.manualInviteHint")}
          </p>
        {/if}
      </article>
    {/each}
  </div>
</section>
