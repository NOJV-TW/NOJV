<script lang="ts">
  import { untrack } from "svelte";
  import { superForm } from "sveltekit-superforms";
  import { m } from "$lib/paraglide/messages.js";
  import type { ProblemDetail } from "$lib/types";
  import { inputClassName, monoTextareaClassName } from "$lib/utils";
  import TagInput from "$lib/components/ui/TagInput.svelte";

  const textareaClassName = `${inputClassName} min-h-28 resize-y`;

  interface Props {
    problem: ProblemDetail;
    formData: any;
  }

  let { problem, formData }: Props = $props();

  const { form, errors, submitting, message: formMessage, enhance } = superForm(untrack(() => formData), {
    dataType: 'json',
  });

  // Tags - sync with superform store
  let tags = $state<string[]>($form.tags ?? []);
  $effect(() => { $form.tags = tags; });
</script>

<section class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm">
  <form class="grid gap-4" method="POST" action="?/updateBasicInfo" use:enhance>
    <!-- Title -->
    <label class="text-sm text-muted-foreground">
      {m.admin_title()}
      <input
        class={inputClassName}
        bind:value={$form.title}
        required
      />
      {#if $errors.title}<span class="text-sm text-red-700 dark:text-red-400">{$errors.title}</span>{/if}
    </label>

    <!-- Slug (readonly in edit mode) -->
    <label class="text-sm text-muted-foreground">
      {m.admin_slug()}
      <input
        class="{inputClassName} opacity-60"
        value={problem.slug}
        readonly
      />
    </label>

    <!-- Difficulty + Visibility -->
    <div class="grid gap-4 md:grid-cols-2">
      <label class="text-sm text-muted-foreground">
        {m.admin_difficulty()}
        <select
          class={inputClassName}
          bind:value={$form.difficulty}
        >
          <option value="easy">easy</option>
          <option value="medium">medium</option>
          <option value="hard">hard</option>
        </select>
        {#if $errors.difficulty}<span class="text-sm text-red-700 dark:text-red-400">{$errors.difficulty}</span>{/if}
      </label>
      <label class="text-sm text-muted-foreground">
        {m.admin_visibility()}
        <select
          class={inputClassName}
          bind:value={$form.visibility}
        >
          <option value="private">private</option>
          <option value="public">public</option>
        </select>
        {#if $errors.visibility}<span class="text-sm text-red-700 dark:text-red-400">{$errors.visibility}</span>{/if}
      </label>
    </div>

    <!-- Status -->
    <label class="text-sm text-muted-foreground">
      {m.admin_status()}
      <select
        class={inputClassName}
        bind:value={$form.status}
      >
        <option value="draft">draft</option>
        <option value="published">published</option>
      </select>
      {#if $errors.status}<span class="text-sm text-red-700 dark:text-red-400">{$errors.status}</span>{/if}
    </label>

    <!-- Tags -->
    <div class="text-sm text-muted-foreground">
      <span>{m.admin_tags()}</span>
      <div class="mt-2">
        <TagInput bind:tags placeholder={m.admin_tagsPlaceholder()} />
      </div>
      {#if $errors.tags}<span class="text-sm text-red-700 dark:text-red-400">{$errors.tags}</span>{/if}
    </div>

    <!-- Summary -->
    <label class="text-sm text-muted-foreground">
      {m.admin_summary()}
      <textarea
        class={textareaClassName}
        bind:value={$form.summary}
      ></textarea>
      {#if $errors.summary}<span class="text-sm text-red-700 dark:text-red-400">{$errors.summary}</span>{/if}
    </label>

    <!-- Statement -->
    <label class="text-sm text-muted-foreground">
      {m.admin_statement()}
      <textarea
        class="{textareaClassName} min-h-40"
        bind:value={$form.statement}
        required
      ></textarea>
      {#if $errors.statement}<span class="text-sm text-red-700 dark:text-red-400">{$errors.statement}</span>{/if}
    </label>

    <!-- Input / Output Format -->
    <div class="grid gap-4 md:grid-cols-2">
      <label class="text-sm text-muted-foreground">
        {m.admin_inputFormat()}
        <textarea
          class={textareaClassName}
          bind:value={$form.inputFormat}
        ></textarea>
        {#if $errors.inputFormat}<span class="text-sm text-red-700 dark:text-red-400">{$errors.inputFormat}</span>{/if}
      </label>
      <label class="text-sm text-muted-foreground">
        {m.admin_outputFormat()}
        <textarea
          class={textareaClassName}
          bind:value={$form.outputFormat}
        ></textarea>
        {#if $errors.outputFormat}<span class="text-sm text-red-700 dark:text-red-400">{$errors.outputFormat}</span>{/if}
      </label>
    </div>

    <!-- Submit -->
    <div class="mt-2 flex items-center justify-end gap-3">
      {#if $formMessage}
        <span class="text-sm text-emerald-600 dark:text-emerald-400">{$formMessage}</span>
      {/if}
      <button
        class="inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={$submitting}
        type="submit"
      >
        {#if $submitting}
          {m.common_saving()}
        {:else}
          {m.common_saveSettings()}
        {/if}
      </button>
    </div>
  </form>
</section>
