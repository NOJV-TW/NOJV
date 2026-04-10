<script lang="ts">
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";

  import type { courseDomain } from "@nojv/domain";
  type CourseMemberRecord = courseDomain.CourseMemberRecord;

  interface Props {
    courseSlug: string;
    courseTitle: string;
    form: SuperValidated<{
      displayName: string;
      email: string;
      username: string;
      role: "student" | "ta" | "teacher";
    }>;
    members: CourseMemberRecord[];
  }

  let { courseSlug, courseTitle, form: formData, members }: Props = $props();

  const { form, errors, submitting, message: formMessage, enhance } = superForm(untrack(() => formData), {
    invalidateAll: true
  });
</script>

<div class="space-y-6">
  <section
    class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-6 py-6 shadow-rest backdrop-blur-sm"
  >
    <div class="flex items-center justify-between gap-4">
      <h3 class="font-display text-title font-semibold">{m.courseManage_members()}</h3>
      <Badge variant="muted" size="md" class="tabular-nums">
        {members.length}
      </Badge>
    </div>
    <div class="mt-5 space-y-3">
      {#each members as member (member.userId)}
        <article
          class="flex items-center justify-between gap-4 rounded-sm border border-border-subtle bg-[color:var(--color-panel)] px-4 py-4"
        >
          <div>
            <p class="text-body-lg font-semibold">{member.displayName}</p>
            <p class="mt-1 text-body-sm text-muted-foreground">
              {member.username ?? "\u2014"} &middot; {member.email}
            </p>
          </div>
          <div class="text-right">
            <p
              class="text-body-sm uppercase tracking-[0.18em] text-muted-foreground"
            >
              {member.courseRole}
            </p>
            <p class="mt-1 text-body-sm text-muted-foreground">
              {member.joinedTokenId ? m.courseManage_joinedViaToken() : m.courseManage_joinedManually()}
            </p>
          </div>
        </article>
      {/each}
    </div>
  </section>

  <section
    class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-6 py-6 shadow-rest backdrop-blur-sm"
  >
    <h3 class="font-display text-title font-semibold">{m.courseManage_enrollMember()}</h3>
    <form
      class="mt-4 grid gap-3"
      method="POST"
      action="?/enroll"
      use:enhance
    >
      <Input
        name="displayName"
        bind:value={$form.displayName}
        placeholder="Display name"
        required
        aria-invalid={$errors.displayName ? "true" : undefined}
      />
      {#if $errors.displayName}<span class="text-body-sm text-destructive">{$errors.displayName}</span>{/if}
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <Input
            name="email"
            bind:value={$form.email}
            placeholder="Email"
            required
            type="email"
            aria-invalid={$errors.email ? "true" : undefined}
          />
          {#if $errors.email}<span class="text-body-sm text-destructive">{$errors.email}</span>{/if}
        </div>
        <div>
          <Input
            name="username"
            bind:value={$form.username}
            placeholder="Username"
            required
            aria-invalid={$errors.username ? "true" : undefined}
          />
          {#if $errors.username}<span class="text-body-sm text-destructive">{$errors.username}</span>{/if}
        </div>
      </div>
      <select
        class="h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-body-sm shadow-rest outline-none transition-[border-color,box-shadow] duration-fast ease-out-soft focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        name="role"
        bind:value={$form.role}
      >
        <option value="student">student</option>
        <option value="ta">ta</option>
        <option value="teacher">teacher</option>
      </select>
      <Button type="submit" loading={$submitting} disabled={$submitting} class="w-fit rounded-full px-5">
        {$submitting ? m.common_enrolling() : m.courseManage_enrollMember()}
      </Button>
    </form>
    {#if $formMessage}
      <p class="mt-4 text-body-sm text-success">{$formMessage}</p>
    {/if}
  </section>
</div>
