<script lang="ts">
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import { supportedLanguages, type AssessmentScoreboardMode, type ContestScoringMode } from "@nojv/core";
  import { inputClassName, toDateTimeLocalValue, toggleArrayItem } from "$lib/utils";
  import type { ContestListItem } from "$lib/server/contest/queries";
  import { Trophy } from "@lucide/svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";

  interface Props {
    contests: ContestListItem[];
    courseSlug: string;
    form: SuperValidated<{
      allowedLanguages: string[];
      endsAt: string;
      frozenAt?: string | undefined;
      ipBindingEnabled: boolean;
      ipViolationMode: string;
      ipWhitelistEnabled: boolean;
      ipWhitelistText: string;
      maxAttempts?: number | null | undefined;
      pageLockEnabled: boolean;
      problemSlugsText: string;
      scoreboardMode: AssessmentScoreboardMode;
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

  function toggleLanguage(lang: string) {
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
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
          <div class="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {#if contest.pageLockEnabled}<span class="rounded-full border border-border px-2 py-0.5">page-lock</span>{/if}
            {#if contest.ipWhitelistEnabled}<span class="rounded-full border border-border px-2 py-0.5">ip-whitelist</span>{/if}
            {#if contest.ipBindingEnabled}<span class="rounded-full border border-border px-2 py-0.5">ip-binding</span>{/if}
            {#if contest.maxAttempts != null}<span class="rounded-full border border-border px-2 py-0.5">max {contest.maxAttempts} attempts</span>{/if}
            <span class="rounded-full border border-border px-2 py-0.5">{contest.scoreboardMode} scoreboard</span>
            {#if contest.allowedLanguages.length > 0}
              <span class="rounded-full border border-border px-2 py-0.5">{contest.allowedLanguages.join(", ")}</span>
            {:else}
              <span class="rounded-full border border-border px-2 py-0.5">all languages</span>
            {/if}
          </div>
        </article>
      {:else}
        <EmptyState
          icon={Trophy}
          title="No contests yet"
          description="Create your first contest below."
        />
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
          {#if $errors.title}<span class="text-sm text-red-700 dark:text-red-400">{$errors.title}</span>{/if}
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
          {#if $errors.slug}<span class="text-sm text-red-700 dark:text-red-400">{$errors.slug}</span>{/if}
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
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <label class="text-xs text-muted-foreground" for="scoreboardMode">Scoreboard mode</label>
          <select class={inputClassName} id="scoreboardMode" name="scoreboardMode" bind:value={$form.scoreboardMode}>
            <option value="live">Live</option>
            <option value="frozen">Frozen</option>
            <option value="hidden">Hidden</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-muted-foreground" for="maxAttempts">Max attempts (optional)</label>
          <input
            class={inputClassName}
            id="maxAttempts"
            name="maxAttempts"
            type="number"
            min="1"
            max="999"
            placeholder="Unlimited"
            bind:value={$form.maxAttempts}
          />
          {#if $errors.maxAttempts}<span class="text-sm text-red-700 dark:text-red-400">{$errors.maxAttempts}</span>{/if}
        </div>
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" name="pageLockEnabled" bind:checked={$form.pageLockEnabled} />
          Page lock (prevent tab switching)
        </label>
        <!-- IP Whitelist -->
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ipWhitelistEnabled" bind:checked={$form.ipWhitelistEnabled} />
          IP Whitelist
        </label>
      </div>
      {#if $form.ipWhitelistEnabled}
        <div class="col-span-full">
          <textarea
            class={textareaClassName}
            name="ipWhitelistText"
            bind:value={$form.ipWhitelistText}
            placeholder="CIDR ranges, one per line&#10;e.g. 140.112.0.0/16&#10;     192.168.1.0/24"
            rows="3"
          ></textarea>
        </div>
      {/if}
      <!-- IP Binding -->
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ipBindingEnabled" bind:checked={$form.ipBindingEnabled} />
        IP First-Binding (lock to first IP used)
      </label>
      <!-- Violation mode (show when any IP lock enabled) -->
      {#if $form.ipWhitelistEnabled || $form.ipBindingEnabled}
        <div class="col-span-full flex items-center gap-4 text-sm">
          <span class="text-muted-foreground">When IP violation occurs:</span>
          <label class="flex items-center gap-1.5">
            <input type="radio" name="ipViolationMode" value="block" bind:group={$form.ipViolationMode} />
            Block
          </label>
          <label class="flex items-center gap-1.5">
            <input type="radio" name="ipViolationMode" value="notify" bind:group={$form.ipViolationMode} />
            Notify only
          </label>
        </div>
      {/if}
      <div>
        <span class="text-xs text-muted-foreground">Allowed languages (leave empty for all)</span>
        <div class="mt-2 flex flex-wrap gap-3">
          {#each supportedLanguages as lang (lang)}
            <label class="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={($form.allowedLanguages ?? []).includes(lang)}
                onchange={() => toggleLanguage(lang)}
              />
              {lang}
            </label>
          {/each}
        </div>
        {#if $errors.allowedLanguages}<span class="text-sm text-red-700 dark:text-red-400">{$errors.allowedLanguages}</span>{/if}
      </div>
      <div>
        <textarea
          class={textareaClassName}
          name="summary"
          bind:value={$form.summary}
          placeholder="Contest summary"
          required
        ></textarea>
        {#if $errors.summary}<span class="text-sm text-red-700 dark:text-red-400">{$errors.summary}</span>{/if}
      </div>
      <div>
        <textarea
          class={textareaClassName}
          name="problemSlugsText"
          bind:value={$form.problemSlugsText}
          placeholder="problem-one, problem-two"
          required
        ></textarea>
        {#if $errors.problemSlugsText}<span class="text-sm text-red-700 dark:text-red-400">{$errors.problemSlugsText}</span>{/if}
      </div>
      <div class="grid gap-3 md:grid-cols-3">
        <div>
          <label class="text-xs text-muted-foreground" for="startsAt">Starts at</label>
          <input class={inputClassName} name="startsAt" bind:value={$form.startsAt} required type="datetime-local" />
          {#if $errors.startsAt}<span class="text-sm text-red-700 dark:text-red-400">{$errors.startsAt}</span>{/if}
        </div>
        <div>
          <label class="text-xs text-muted-foreground" for="endsAt">Ends at</label>
          <input class={inputClassName} name="endsAt" bind:value={$form.endsAt} required type="datetime-local" />
          {#if $errors.endsAt}<span class="text-sm text-red-700 dark:text-red-400">{$errors.endsAt}</span>{/if}
        </div>
        <div>
          <label class="text-xs text-muted-foreground" for="frozenAt">Freeze at (optional)</label>
          <input class={inputClassName} name="frozenAt" bind:value={$form.frozenAt} type="datetime-local" />
        </div>
      </div>
      <button
        class="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={$submitting}
        type="submit"
      >
        {$submitting ? "Creating..." : "Create Contest"}
      </button>
    </form>
    {#if $formMessage}
      <p class="mt-4 text-sm text-emerald-700 dark:text-emerald-400">{$formMessage}</p>
    {/if}
  </section>
</div>
