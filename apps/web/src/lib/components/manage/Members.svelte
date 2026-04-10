<script lang="ts">
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import { m } from "$lib/paraglide/messages.js";

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
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
  >
    <div class="flex items-center justify-between gap-4">
      <h3 class="text-2xl font-semibold">{m.courseManage_members()}</h3>
      <span
        class="rounded-full border border-border px-3 py-1 text-xs font-medium"
      >
        {members.length}
      </span>
    </div>
    <div class="mt-5 space-y-3">
      {#each members as member (member.userId)}
        <article
          class="flex items-center justify-between gap-4 rounded-[1.5rem] border border-border bg-[color:var(--color-panel)] px-4 py-4"
        >
          <div>
            <p class="text-lg font-semibold">{member.displayName}</p>
            <p class="mt-1 text-sm text-muted-foreground">
              {member.username ?? "\u2014"} &middot; {member.email}
            </p>
          </div>
          <div class="text-right">
            <p
              class="text-sm uppercase tracking-[0.18em] text-muted-foreground"
            >
              {member.courseRole}
            </p>
            <p class="mt-1 text-sm text-muted-foreground">
              {member.joinedTokenId ? m.courseManage_joinedViaToken() : m.courseManage_joinedManually()}
            </p>
          </div>
        </article>
      {/each}
    </div>
  </section>

  <section
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
  >
    <h3 class="text-2xl font-semibold">{m.courseManage_enrollMember()}</h3>
    <form
      class="mt-4 grid gap-3"
      method="POST"
      action="?/enroll"
      use:enhance
    >
      <input
        class="mt-2 w-full rounded-2xl border border-border bg-[color:var(--color-panel)] px-3 py-3 text-sm"
        name="displayName"
        bind:value={$form.displayName}
        placeholder="Display name"
        required
      />
      {#if $errors.displayName}<span class="text-sm text-red-700 dark:text-red-400">{$errors.displayName}</span>{/if}
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <input
            class="mt-2 w-full rounded-2xl border border-border bg-[color:var(--color-panel)] px-3 py-3 text-sm"
            name="email"
            bind:value={$form.email}
            placeholder="Email"
            required
            type="email"
          />
          {#if $errors.email}<span class="text-sm text-red-700 dark:text-red-400">{$errors.email}</span>{/if}
        </div>
        <div>
          <input
            class="mt-2 w-full rounded-2xl border border-border bg-[color:var(--color-panel)] px-3 py-3 text-sm"
            name="username"
            bind:value={$form.username}
            placeholder="Username"
            required
          />
          {#if $errors.username}<span class="text-sm text-red-700 dark:text-red-400">{$errors.username}</span>{/if}
        </div>
      </div>
      <select class="mt-2 w-full rounded-2xl border border-border bg-[color:var(--color-panel)] px-3 py-3 text-sm" name="role" bind:value={$form.role}>
        <option value="student">student</option>
        <option value="ta">ta</option>
        <option value="teacher">teacher</option>
      </select>
      <button
        class="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={$submitting}
        type="submit"
      >
        {$submitting ? m.common_enrolling() : m.courseManage_enrollMember()}
      </button>
    </form>
    {#if $formMessage}
      <p class="mt-4 text-sm text-emerald-700 dark:text-emerald-400">{$formMessage}</p>
    {/if}
  </section>
</div>
