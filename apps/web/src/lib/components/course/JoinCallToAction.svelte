<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { t } from "svelte-i18n";
  import { readPlatformRole } from "$lib/validation";

  interface Props {
    courseSlug: string;
    courseTitle: string;
    joinMethod: "join_code" | "manual_invite" | "qr_code" | null;
    joinToken: string | null;
  }

  let { courseSlug, courseTitle, joinMethod, joinToken }: Props = $props();

  let isJoining = $state(false);
  let error = $state<string | null>(null);

  let user = $derived($page.data.user as { name: string } | null);
  let platformRole = $derived(readPlatformRole(user));

  async function handleJoin() {
    if (!joinMethod || !joinToken || joinMethod === "manual_invite") {
      error = $t("courseJoin.incompleteLink");
      return;
    }

    isJoining = true;
    error = null;

    try {
      const payload = { joinMethod, joinToken };

      const formData = new FormData();
      formData.set("data", JSON.stringify(payload));

      const response = await fetch("?/join", { method: "POST", body: formData });
      const result = await response.json();

      if (result.type === "failure") {
        throw new Error(result.data?.error ?? $t("courseJoin.joinFailed"));
      }

      goto(`/courses/${courseSlug}`);
    } catch (issue) {
      error = issue instanceof Error ? issue.message : $t("courseJoin.joinFailed");
    } finally {
      isJoining = false;
    }
  }
</script>

<section
  class="rounded-[2rem] border border-[color:var(--color-border)] bg-gradient-to-br from-white/90 to-stone-50/80 px-6 py-8 sm:px-8"
>
  <p class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
    {$t("courseJoin.heading")}
  </p>
  <h2 class="mt-2 font-[family-name:var(--font-display)] text-4xl">{courseTitle}</h2>
  <p class="mt-4 max-w-2xl text-base leading-7 text-[color:var(--color-muted)]">
    {$t("courseJoin.description", { values: { name: user?.name ?? "" } })}
  </p>
  <div class="mt-6 flex flex-wrap items-center gap-3">
    <span
      class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
    >
      {joinMethod ? joinMethod.replaceAll("_", " ") : "missing join method"}
    </span>
    <span
      class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
    >
      {platformRole}
    </span>
  </div>
  <div class="mt-6 flex flex-wrap gap-3">
    <button
      class="rounded-full bg-[color:var(--color-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
      disabled={isJoining}
      onclick={() => void handleJoin()}
      type="button"
    >
      {isJoining ? $t("common.joining") : $t("courseJoin.joinButton")}
    </button>
    <a
      class="rounded-full border border-[color:var(--color-border)] px-5 py-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-white/70"
      href="/courses/{courseSlug}"
    >
      {$t("courseJoin.backToCourse")}
    </a>
  </div>
  {#if joinToken}
    <p class="mt-4 text-sm text-[color:var(--color-muted)]">
      {$t("courseJoin.token")}: {joinToken}
    </p>
  {/if}
  {#if error}
    <div
      class="mt-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {error}
    </div>
  {/if}
</section>
