<script lang="ts">
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import { m } from "$lib/paraglide/messages.js";

  import type { courseDomain } from "@nojv/domain";
  type CourseProblemCatalogEntry = courseDomain.CourseProblemCatalogEntry;

  interface Props {
    courseSlug: string;
    courseTitle: string;
    form: SuperValidated<{ problemId: string }>;
    problems: CourseProblemCatalogEntry[];
  }

  let { courseSlug, courseTitle, form: formData, problems }: Props = $props();

  const { form, errors, submitting, message: formMessage, enhance } = superForm(untrack(() => formData), {
    invalidateAll: true
  });
</script>

<div class="space-y-6">
  <section
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
  >
    <div class="flex items-center justify-between gap-4">
      <h3 class="text-2xl font-semibold">{m.courseManage_courseProblems()}</h3>
      <span
        class="rounded-full border border-border px-3 py-1 text-xs font-medium"
      >
        {problems.length}
      </span>
    </div>
    <div class="mt-5 grid gap-3">
      {#each problems as problem (problem.id)}
        <article
          class="flex items-center justify-between gap-4 rounded-[1.5rem] border border-border bg-[color:var(--color-panel)] px-4 py-4"
        >
          <div>
            <p class="text-lg font-semibold">{problem.title}</p>
            <p class="mt-2 text-sm text-muted-foreground">
              {problem.summary}
            </p>
          </div>
          <div class="text-right">
            <span
              class="rounded-full border border-border px-3 py-1 text-xs font-medium"
            >
              {problem.visibility}
            </span>
            <p class="mt-2 text-sm text-muted-foreground">
              by {problem.authorUsername}
            </p>
          </div>
        </article>
      {/each}
    </div>
  </section>

  <section
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
  >
    <h3 class="text-2xl font-semibold">{m.courseManage_attachProblem()}</h3>
    <form
      class="mt-4 grid gap-3"
      method="POST"
      action="?/attach"
      use:enhance
    >
      <input
        class="mt-2 w-full rounded-2xl border border-border bg-[color:var(--color-panel)] px-3 py-3 text-sm"
        name="problemId"
        bind:value={$form.problemId}
        placeholder="problem-id"
        required
      />
      {#if $errors.problemId}<span class="text-sm text-red-700 dark:text-red-400">{$errors.problemId}</span>{/if}
      <button
        class="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={$submitting}
        type="submit"
      >
        {$submitting ? m.common_attaching() : m.courseManage_attachProblem()}
      </button>
    </form>
    {#if $formMessage}
      <p class="mt-4 text-sm text-emerald-700 dark:text-emerald-400">{$formMessage}</p>
    {/if}
  </section>
</div>
