<script lang="ts">
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import { m } from "$lib/paraglide/messages.js";

  import type { CourseProblemCatalogEntry } from "$lib/server/course/queries";

  interface Props {
    courseSlug: string;
    courseTitle: string;
    form: SuperValidated<{ problemSlug: string }>;
    problems: CourseProblemCatalogEntry[];
  }

  let { courseSlug, courseTitle, form: formData, problems }: Props = $props();

  const { form, errors, submitting, message: formMessage, enhance } = superForm(formData, {
    invalidateAll: true
  });
</script>

<div class="space-y-6">
  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
  >
    <div class="flex items-center justify-between gap-4">
      <h3 class="text-2xl font-semibold">{m.courseManage_courseProblems()}</h3>
      <span
        class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
      >
        {problems.length}
      </span>
    </div>
    <div class="mt-5 grid gap-3">
      {#each problems as problem (problem.slug)}
        <article
          class="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
        >
          <div>
            <p class="text-lg font-semibold">{problem.title}</p>
            <p class="mt-2 text-sm text-[color:var(--color-muted)]">
              {problem.summary}
            </p>
          </div>
          <div class="text-right">
            <span
              class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
            >
              {problem.visibility}
            </span>
            <p class="mt-2 text-sm text-[color:var(--color-muted)]">
              by {problem.authorHandle}
            </p>
          </div>
        </article>
      {/each}
    </div>
  </section>

  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
  >
    <h3 class="text-2xl font-semibold">{m.courseManage_attachProblem()}</h3>
    <form
      class="mt-4 grid gap-3"
      method="POST"
      action="?/attach"
      use:enhance
    >
      <input
        class="mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm"
        name="problemSlug"
        bind:value={$form.problemSlug}
        pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
        placeholder="problem-slug"
        required
      />
      {#if $errors.problemSlug}<span class="text-sm text-red-700">{$errors.problemSlug}</span>{/if}
      <button
        class="inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={$submitting}
        type="submit"
      >
        {$submitting ? m.common_attaching() : m.courseManage_attachProblem()}
      </button>
    </form>
    {#if $formMessage}
      <p class="mt-4 text-sm text-emerald-700">{$formMessage}</p>
    {/if}
  </section>
</div>
