<script lang="ts">
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import { m } from "$lib/paraglide/messages.js";

  import type { CourseMemberRecord } from "$lib/server/course/queries";

  interface Props {
    courseSlug: string;
    courseTitle: string;
    form: SuperValidated<{
      displayName: string;
      email: string;
      handle: string;
      role: "student" | "ta" | "teacher";
    }>;
    members: CourseMemberRecord[];
  }

  let { courseSlug, courseTitle, form: formData, members }: Props = $props();

  const { form, errors, submitting, message: formMessage, enhance } = superForm(formData, {
    invalidateAll: true
  });
</script>

<div class="space-y-6">
  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
  >
    <div class="flex items-center justify-between gap-4">
      <h3 class="text-2xl font-semibold">{m.courseManage_members()}</h3>
      <span
        class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
      >
        {members.length}
      </span>
    </div>
    <div class="mt-5 space-y-3">
      {#each members as member (member.userId)}
        <article
          class="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
        >
          <div>
            <p class="text-lg font-semibold">{member.displayName}</p>
            <p class="mt-1 text-sm text-[color:var(--color-muted)]">
              {member.handle ?? "\u2014"} &middot; {member.email}
            </p>
          </div>
          <div class="text-right">
            <p
              class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]"
            >
              {member.courseRole}
            </p>
            <p class="mt-1 text-sm text-[color:var(--color-muted)]">
              via {member.joinedVia.replaceAll("_", " ")}
            </p>
          </div>
        </article>
      {/each}
    </div>
  </section>

  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
  >
    <h3 class="text-2xl font-semibold">{m.courseManage_enrollMember()}</h3>
    <form
      class="mt-4 grid gap-3"
      method="POST"
      action="?/enroll"
      use:enhance
    >
      <input
        class="mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm"
        name="displayName"
        bind:value={$form.displayName}
        placeholder="Display name"
        required
      />
      {#if $errors.displayName}<span class="text-sm text-red-700">{$errors.displayName}</span>{/if}
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <input
            class="mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm"
            name="email"
            bind:value={$form.email}
            placeholder="Email"
            required
            type="email"
          />
          {#if $errors.email}<span class="text-sm text-red-700">{$errors.email}</span>{/if}
        </div>
        <div>
          <input
            class="mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm"
            name="handle"
            bind:value={$form.handle}
            placeholder="Handle"
            required
          />
          {#if $errors.handle}<span class="text-sm text-red-700">{$errors.handle}</span>{/if}
        </div>
      </div>
      <select class="mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm" name="role" bind:value={$form.role}>
        <option value="student">student</option>
        <option value="ta">ta</option>
        <option value="teacher">teacher</option>
      </select>
      <button
        class="inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={$submitting}
        type="submit"
      >
        {$submitting ? m.common_enrolling() : m.courseManage_enrollMember()}
      </button>
    </form>
    {#if $formMessage}
      <p class="mt-4 text-sm text-emerald-700">{$formMessage}</p>
    {/if}
  </section>
</div>
