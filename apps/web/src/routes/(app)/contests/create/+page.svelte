<script lang="ts">
  import { superForm } from "sveltekit-superforms/client";
  import { inputClassName } from "$lib/utils";

  let { data } = $props();

  const { form, errors, enhance, message: formMessage } = superForm(data.form, {
    resetForm: false
  });
</script>

<div class="space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">Create Contest</h2>

  {#if $formMessage}
    <div class="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
      {$formMessage}
    </div>
  {/if}

  <form method="POST" action="?/create" use:enhance class="space-y-5 max-w-2xl">
    <div>
      <label class="text-sm font-medium" for="slug">Slug</label>
      <input
        class={inputClassName}
        id="slug"
        name="slug"
        type="text"
        placeholder="spring-2026-contest"
        bind:value={$form.slug}
      />
      {#if $errors.slug}<p class="mt-1 text-xs text-red-600">{$errors.slug}</p>{/if}
    </div>

    <div>
      <label class="text-sm font-medium" for="title">Title</label>
      <input
        class={inputClassName}
        id="title"
        name="title"
        type="text"
        placeholder="Spring 2026 Programming Contest"
        bind:value={$form.title}
      />
      {#if $errors.title}<p class="mt-1 text-xs text-red-600">{$errors.title}</p>{/if}
    </div>

    <div>
      <label class="text-sm font-medium" for="summary">Summary</label>
      <textarea
        class="{inputClassName} min-h-24 resize-y"
        id="summary"
        name="summary"
        placeholder="Contest description..."
        bind:value={$form.summary}
      ></textarea>
      {#if $errors.summary}<p class="mt-1 text-xs text-red-600">{$errors.summary}</p>{/if}
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="text-sm font-medium" for="startsAt">Starts at</label>
        <input
          class={inputClassName}
          id="startsAt"
          name="startsAt"
          type="datetime-local"
          bind:value={$form.startsAt}
        />
        {#if $errors.startsAt}<p class="mt-1 text-xs text-red-600">{$errors.startsAt}</p>{/if}
      </div>
      <div>
        <label class="text-sm font-medium" for="endsAt">Ends at</label>
        <input
          class={inputClassName}
          id="endsAt"
          name="endsAt"
          type="datetime-local"
          bind:value={$form.endsAt}
        />
        {#if $errors.endsAt}<p class="mt-1 text-xs text-red-600">{$errors.endsAt}</p>{/if}
      </div>
    </div>

    <div>
      <label class="text-sm font-medium" for="scoringMode">Scoring mode</label>
      <select class={inputClassName} id="scoringMode" name="scoringMode" bind:value={$form.scoringMode}>
        <option value="icpc">ICPC (AC + penalty)</option>
        <option value="ioi">IOI (best score per problem)</option>
      </select>
    </div>

    <div>
      <label class="text-sm font-medium" for="submitCooldownSec">Submit cooldown (seconds)</label>
      <input
        class={inputClassName}
        id="submitCooldownSec"
        name="submitCooldownSec"
        type="number"
        min="0"
        max="3600"
        bind:value={$form.submitCooldownSec}
      />
      {#if $errors.submitCooldownSec}<p class="mt-1 text-xs text-red-600">{$errors.submitCooldownSec}</p>{/if}
    </div>

    <div>
      <label class="text-sm font-medium" for="frozenAt">Freeze scoreboard at (optional)</label>
      <input
        class={inputClassName}
        id="frozenAt"
        name="frozenAt"
        type="datetime-local"
        bind:value={$form.frozenAt}
      />
    </div>

    <div>
      <label class="text-sm font-medium" for="problemSlugsText">Problem slugs (comma-separated)</label>
      <input
        class={inputClassName}
        id="problemSlugsText"
        name="problemSlugsText"
        type="text"
        placeholder="two-sum, reverse-string, binary-search"
        bind:value={$form.problemSlugsText}
      />
      {#if $errors.problemSlugsText}<p class="mt-1 text-xs text-red-600">{$errors.problemSlugsText}</p>{/if}
    </div>

    <button
      class="rounded-2xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
      type="submit"
    >
      Create Contest
    </button>
  </form>
</div>
