<script lang="ts">
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import type { ContestScoringMode } from "@nojv/core";
  import { inputClassName } from "$lib/utils";
  import type { ContestListItem } from "$lib/server/contest/queries";

  interface Props {
    contests: ContestListItem[];
    courseSlug: string;
    form: SuperValidated<{
      endsAt: string;
      frozenAt?: string | undefined;
      problemSlugsText: string;
      scoringMode: ContestScoringMode;
      slug: string;
      startsAt: string;
      submitCooldownSec: number;
      summary: string;
      title: string;
    }>;
    problemSlugs: string[];
  }

  let { contests, courseSlug, form: formData, problemSlugs }: Props = $props();
  const initialProblemSlugs = untrack(() => problemSlugs);

  function toDateTimeLocalValue(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${String(year)}-${month}-${day}T${hours}:${minutes}`;
  }

  const textareaClassName = `${inputClassName} min-h-24 resize-y`;

  const defaultStart = toDateTimeLocalValue(new Date());
  const defaultEnd = toDateTimeLocalValue(
    new Date(Date.now() + 1000 * 60 * 60 * 3)
  );

  const { form, errors, submitting, message: formMessage, enhance } = superForm(
    untrack(() => formData),
    { invalidateAll: true }
  );

  if (!$form.startsAt) $form.startsAt = defaultStart;
  if (!$form.endsAt) $form.endsAt = defaultEnd;
  if (!$form.problemSlugsText) $form.problemSlugsText = initialProblemSlugs.join(", ");
  if (!$form.scoringMode) $form.scoringMode = "icpc";
</script>

<div class="space-y-6">
  <!-- Existing contests -->
  <section
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
  >
    <div class="flex items-center justify-between gap-4">
      <h3 class="text-2xl font-semibold">Contests</h3>
      <span class="rounded-full border border-border px-3 py-1 text-xs font-medium">
        {contests.length}
      </span>
    </div>
    <div class="mt-5 grid gap-3">
      {#each contests as contest (contest.slug)}
        <article
          class="rounded-[1.5rem] border border-border bg-[color:var(--color-panel)] px-4 py-4"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
                {contest.scoringMode}
              </p>
              <a href="/contests/{contest.slug}" class="mt-2 text-lg font-semibold hover:underline">
                {contest.title}
              </a>
            </div>
            <span class="rounded-full border border-border px-3 py-1 text-xs font-medium">
              {contest.problemCount} problems
            </span>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            {contest.startsAt.slice(0, 10)} &rarr; {contest.endsAt.slice(0, 10)}
            &middot; {contest.participantCount} participants
          </p>
        </article>
      {:else}
        <p class="text-sm text-muted-foreground">No contests yet.</p>
      {/each}
    </div>
  </section>

  <!-- Create contest form -->
  <section
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
  >
    <h3 class="text-2xl font-semibold">Create Contest</h3>
    <form class="mt-4 grid gap-3" method="POST" action="?/createContest" use:enhance>
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <input
            class={inputClassName}
            name="title"
            bind:value={$form.title}
            placeholder="Contest title"
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
            placeholder="contest-slug"
            required
          />
          {#if $errors.slug}<span class="text-sm text-red-700">{$errors.slug}</span>{/if}
        </div>
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <select class={inputClassName} name="scoringMode" bind:value={$form.scoringMode}>
          <option value="icpc">ICPC (AC + penalty)</option>
          <option value="ioi">IOI (best score)</option>
        </select>
        <div>
          <input
            class={inputClassName}
            name="submitCooldownSec"
            type="number"
            min="0"
            max="3600"
            bind:value={$form.submitCooldownSec}
            placeholder="Cooldown (sec)"
          />
        </div>
      </div>
      <div>
        <textarea
          class={textareaClassName}
          name="summary"
          bind:value={$form.summary}
          placeholder="Contest summary"
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
          <label class="text-xs text-muted-foreground" for="startsAt">Starts at</label>
          <input class={inputClassName} name="startsAt" bind:value={$form.startsAt} required type="datetime-local" />
          {#if $errors.startsAt}<span class="text-sm text-red-700">{$errors.startsAt}</span>{/if}
        </div>
        <div>
          <label class="text-xs text-muted-foreground" for="endsAt">Ends at</label>
          <input class={inputClassName} name="endsAt" bind:value={$form.endsAt} required type="datetime-local" />
          {#if $errors.endsAt}<span class="text-sm text-red-700">{$errors.endsAt}</span>{/if}
        </div>
        <div>
          <label class="text-xs text-muted-foreground" for="frozenAt">Freeze at (optional)</label>
          <input class={inputClassName} name="frozenAt" bind:value={$form.frozenAt} type="datetime-local" />
        </div>
      </div>
      <button
        class="inline-flex w-fit rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={$submitting}
        type="submit"
      >
        {$submitting ? "Creating..." : "Create Contest"}
      </button>
    </form>
    {#if $formMessage}
      <p class="mt-4 text-sm text-emerald-700">{$formMessage}</p>
    {/if}
  </section>
</div>
