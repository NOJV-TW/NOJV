<script lang="ts">
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import { m } from "$lib/paraglide/messages.js";
  import { inputClassName } from "$lib/utils";

  import type { CourseAssessmentRecord } from "$lib/server/course/queries";

  interface Props {
    assessments: CourseAssessmentRecord[];
    courseSlug: string;
    form: SuperValidated<{
      closesAt: string;
      dueAt: string;
      ipLockEnabled: boolean;
      maxAttempts?: number | null | undefined;
      opensAt: string;
      pageLockEnabled: boolean;
      problemSlugsText: string;
      scoreboardMode?: "hidden" | "live" | "frozen" | undefined;
      slug: string;
      summary: string;
      title: string;
      type: "assignment" | "exam";
    }>;
    problemSlugs: string[];
  }

  let { assessments, courseSlug, form: formData, problemSlugs }: Props = $props();
  const initialProblemSlugs = untrack(() => problemSlugs);

  function toDateTimeLocalValue(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${String(year)}-${month}-${day}T${hours}:${minutes}`;
  }

  function createDefaultAssessmentWindow() {
    const opensAt = new Date();
    const dueAt = new Date(opensAt.getTime() + 1000 * 60 * 60 * 24 * 7);
    const closesAt = new Date(dueAt.getTime() + 1000 * 60 * 60 * 24);
    return {
      closesAt: toDateTimeLocalValue(closesAt),
      dueAt: toDateTimeLocalValue(dueAt),
      opensAt: toDateTimeLocalValue(opensAt)
    };
  }

  const textareaClassName = `${inputClassName} min-h-24 resize-y`;

  const defaultWindow = createDefaultAssessmentWindow();

  const { form, errors, submitting, message: formMessage, enhance } = superForm(untrack(() => formData), {
    invalidateAll: true
  });

  // Set defaults for datetime fields
  if (!$form.opensAt) $form.opensAt = defaultWindow.opensAt;
  if (!$form.dueAt) $form.dueAt = defaultWindow.dueAt;
  if (!$form.closesAt) $form.closesAt = defaultWindow.closesAt;
  if (!$form.problemSlugsText) $form.problemSlugsText = initialProblemSlugs.join(", ");
  if (!$form.type) $form.type = "assignment";
</script>

<div class="space-y-6">
  <section
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
  >
    <div class="flex items-center justify-between gap-4">
      <h3 class="text-2xl font-semibold">{m.courseManage_assessments()}</h3>
      <span
        class="rounded-full border border-border px-3 py-1 text-xs font-medium"
      >
        {assessments.length}
      </span>
    </div>
    <div class="mt-5 grid gap-3">
      {#each assessments as assessment (assessment.slug)}
        <article
          class="rounded-[1.5rem] border border-border bg-[color:var(--color-panel)] px-4 py-4"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <p
                class="text-sm uppercase tracking-[0.18em] text-muted-foreground"
              >
                {assessment.type}
              </p>
              <p class="mt-2 text-lg font-semibold">{assessment.title}</p>
              <p class="mt-2 text-sm text-muted-foreground">
                {assessment.summary}
              </p>
            </div>
            <span
              class="rounded-full border border-border px-3 py-1 text-xs font-medium"
            >
              {assessment.problemSlugs.length} problems
            </span>
          </div>
          <p class="mt-3 text-sm text-muted-foreground">
            {assessment.opensAt.slice(0, 10)} &rarr; {assessment.closesAt.slice(0, 10)}
          </p>
        </article>
      {/each}
    </div>
  </section>

  <section
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
  >
    <h3 class="text-2xl font-semibold">{m.courseManage_publishAssessment()}</h3>
    <form
      class="mt-4 grid gap-3"
      method="POST"
      action="?/create"
      use:enhance
    >
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <input
            class={inputClassName}
            name="title"
            bind:value={$form.title}
            placeholder="Assessment title"
            required
          />
          {#if $errors.title}<span class="text-sm text-red-700">{$errors.title}</span>{/if}
        </div>
        <div>
          <input
            class={inputClassName}
            name="slug"
            bind:value={$form.slug}
            pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
            placeholder="assessment-slug"
            required
          />
          {#if $errors.slug}<span class="text-sm text-red-700">{$errors.slug}</span>{/if}
        </div>
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <select class={inputClassName} name="type" bind:value={$form.type}>
          <option value="assignment">assignment</option>
          <option value="exam">exam</option>
        </select>
        <select class={inputClassName} name="scoreboardMode" bind:value={$form.scoreboardMode}>
          <option value="hidden">hidden</option>
          <option value="live">live</option>
          <option value="frozen">frozen</option>
        </select>
      </div>
      <div>
        <textarea
          class={textareaClassName}
          name="summary"
          bind:value={$form.summary}
          placeholder="Assessment summary"
          required
        ></textarea>
        {#if $errors.summary}<span class="text-sm text-red-700">{$errors.summary}</span>{/if}
      </div>
      <div>
        <textarea
          class={textareaClassName}
          name="problemSlugsText"
          bind:value={$form.problemSlugsText}
          placeholder="problem-one, problem-two"
          required
        ></textarea>
        {#if $errors.problemSlugsText}<span class="text-sm text-red-700">{$errors.problemSlugsText}</span>{/if}
      </div>
      <div class="grid gap-3 md:grid-cols-3">
        <div>
          <input class={inputClassName} name="opensAt" bind:value={$form.opensAt} required type="datetime-local" />
          {#if $errors.opensAt}<span class="text-sm text-red-700">{$errors.opensAt}</span>{/if}
        </div>
        <div>
          <input class={inputClassName} name="dueAt" bind:value={$form.dueAt} required type="datetime-local" />
          {#if $errors.dueAt}<span class="text-sm text-red-700">{$errors.dueAt}</span>{/if}
        </div>
        <div>
          <input class={inputClassName} name="closesAt" bind:value={$form.closesAt} required type="datetime-local" />
          {#if $errors.closesAt}<span class="text-sm text-red-700">{$errors.closesAt}</span>{/if}
        </div>
      </div>
      <button
        class="inline-flex w-fit rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={$submitting}
        type="submit"
      >
        {$submitting ? m.common_publishing() : m.courseManage_publishAssessment()}
      </button>
    </form>
    {#if $formMessage}
      <p class="mt-4 text-sm text-emerald-700">{$formMessage}</p>
    {/if}
  </section>
</div>
