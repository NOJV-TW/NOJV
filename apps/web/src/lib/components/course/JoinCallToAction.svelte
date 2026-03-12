<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { m } from "$lib/paraglide/messages.js";
  import { actionErrorSchema } from "@nojv/core";
  import { readPlatformRole } from "$lib/validation";
  import { superForm } from "sveltekit-superforms";

  interface Props {
    courseSlug: string;
    courseTitle: string;
    form: any;
    joinMethod: "join_code" | "manual_invite" | "qr_code" | null;
    joinToken: string | null;
  }

  let { courseSlug, courseTitle, form, joinMethod, joinToken }: Props = $props();

  let error = $state<string | null>(null);

  let user = $derived($page.data.user);
  let platformRole = $derived(readPlatformRole(user));

  const { enhance, submitting } = superForm(untrack(() => form), {
    onResult({ result }) {
      if (result.type === "success" || result.type === "redirect") {
        goto(`/courses/${courseSlug}`);
      } else if (result.type === "failure") {
        const parsed = actionErrorSchema.safeParse(result.data);
        error = parsed.success ? parsed.data.error : m.courseJoin_joinFailed();
      } else if (result.type === "error") {
        error = result.error?.message ?? m.courseJoin_joinFailed();
      }
    },
    onError({ result }) {
      error = result.error.message ?? m.courseJoin_joinFailed();
    }
  });

  function handlePreCheck() {
    if (!joinMethod || !joinToken || joinMethod === "manual_invite") {
      error = m.courseJoin_incompleteLink();
      return false;
    }
    error = null;
    return true;
  }
</script>

<section
  class="rounded-[2rem] border border-border bg-[color:var(--color-panel-strong)] px-6 py-8 backdrop-blur-sm sm:px-8"
>
  <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
    {m.courseJoin_heading()}
  </p>
  <h2 class="mt-2 font-[family-name:var(--font-display)] text-4xl">{courseTitle}</h2>
  <p class="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
    {m.courseJoin_description({ name: user?.name ?? "" })}
  </p>
  <div class="mt-6 flex flex-wrap items-center gap-3">
    <span
      class="rounded-full border border-border px-3 py-1 text-xs font-medium"
    >
      {joinMethod ? joinMethod.replaceAll("_", " ") : "missing join method"}
    </span>
    <span
      class="rounded-full border border-border px-3 py-1 text-xs font-medium"
    >
      {platformRole}
    </span>
  </div>
  <form
    action="?/join"
    method="POST"
    use:enhance
    onsubmit={(e) => {
      if (!handlePreCheck()) e.preventDefault();
    }}
  >
    <input type="hidden" name="joinMethod" value={joinMethod ?? ""} />
    <input type="hidden" name="joinToken" value={joinToken ?? ""} />
    <div class="mt-6 flex flex-wrap gap-3">
      <button
        class="rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={$submitting}
        type="submit"
      >
        {$submitting ? m.common_joining() : m.courseJoin_joinButton()}
      </button>
      <a
        class="rounded-full border border-border px-5 py-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-[color:var(--color-panel)]"
        href="/courses/{courseSlug}"
      >
        {m.courseJoin_backToCourse()}
      </a>
    </div>
  </form>
  {#if joinToken}
    <p class="mt-4 text-sm text-muted-foreground">
      {m.courseJoin_token()}: {joinToken}
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
