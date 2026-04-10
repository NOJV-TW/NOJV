<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { m } from "$lib/paraglide/messages.js";
  import { actionErrorSchema, type CourseJoinTokenKind } from "@nojv/core";
  import { superForm } from "sveltekit-superforms";
  import { Button, LinkButton } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";

  interface Props {
    courseSlug: string;
    courseTitle: string;
    form: any;
    joinTokenKind: CourseJoinTokenKind | null;
    joinToken: string | null;
  }

  let { courseSlug, courseTitle, form, joinTokenKind, joinToken }: Props = $props();

  let error = $state<string | null>(null);

  let user = $derived($page.data.user);
  let platformRole = $derived(user?.platformRole ?? "student");

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
    if (!joinTokenKind || !joinToken) {
      error = m.courseJoin_incompleteLink();
      return false;
    }
    error = null;
    return true;
  }
</script>

<section
  class="rounded-2xl border border-border bg-[color:var(--color-panel-strong)] px-6 py-8 backdrop-blur-sm shadow-rest sm:px-8"
>
  <p class="text-caption uppercase tracking-[0.18em] text-muted-foreground">
    {m.courseJoin_heading()}
  </p>
  <h2 class="mt-2 font-display text-headline">{courseTitle}</h2>
  <p class="mt-4 max-w-2xl text-body leading-relaxed text-muted-foreground">
    {m.courseJoin_description({ name: user?.name ?? "" })}
  </p>
  <div class="mt-6 flex flex-wrap items-center gap-3">
    <Badge variant="muted">
      {joinTokenKind ?? "missing join kind"}
    </Badge>
    <Badge variant="muted">
      {platformRole}
    </Badge>
  </div>
  <form
    action="?/join"
    method="POST"
    use:enhance
    onsubmit={(e) => {
      if (!handlePreCheck()) e.preventDefault();
    }}
  >
    <input type="hidden" name="joinTokenKind" value={joinTokenKind ?? ""} />
    <input type="hidden" name="joinToken" value={joinToken ?? ""} />
    <div class="mt-6 flex flex-wrap gap-3">
      <Button type="submit" loading={$submitting} disabled={$submitting}>
        {$submitting ? m.common_joining() : m.courseJoin_joinButton()}
      </Button>
      <LinkButton href="/courses/{courseSlug}" variant="outline">
        {m.courseJoin_backToCourse()}
      </LinkButton>
    </div>
  </form>
  {#if joinToken}
    <p class="mt-4 text-body-sm text-muted-foreground">
      {m.courseJoin_token()}: <span class="font-mono tabular-nums">{joinToken}</span>
    </p>
  {/if}
  {#if error}
    <div
      class="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-body-sm text-destructive"
    >
      {error}
    </div>
  {/if}
</section>
