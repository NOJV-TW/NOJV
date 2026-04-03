<script lang="ts">
  import { untrack } from "svelte";
  import { superForm } from "sveltekit-superforms";
  import { m } from "$lib/paraglide/messages.js";
  import type { ProblemDetail } from "$lib/types";
  import { inputClassName, monoTextareaClassName } from "$lib/utils";

  const textareaClassName = `${inputClassName} min-h-28 resize-y`;

  interface Props {
    problem: ProblemDetail;
    formData: any;
  }

  let { problem, formData }: Props = $props();

  const { form, errors, submitting, message: formMessage, enhance } = superForm(untrack(() => formData), {
    dataType: 'json',
  });

  // Tags
  let tagInput = $state("");
  let tagInputEl: HTMLInputElement;

  function addTag(raw: string) {
    const tag = raw.trim();
    if (tag.length > 0 && !$form.tags!.includes(tag)) {
      $form.tags = [...($form.tags ?? []), tag];
    }
    tagInput = "";
  }

  function removeTag(index: number) {
    $form.tags = ($form.tags ?? []).filter((_: string, i: number) => i !== index);
  }

  function handleTagKeyDown(event: KeyboardEvent) {
    if ((event.key === " " || event.key === "Enter") && tagInput.trim().length > 0) {
      event.preventDefault();
      addTag(tagInput);
    }
    if (event.key === "Backspace" && tagInput === "" && ($form.tags ?? []).length > 0) {
      $form.tags = ($form.tags ?? []).slice(0, -1);
    }
  }
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
      狀態
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
      <div
        class="mt-2 flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-2xl border border-border bg-[color:var(--color-panel)] px-3 py-2"
        onclick={() => tagInputEl?.focus()}
        role="textbox"
        tabindex="-1"
        onkeydown={() => {}}
      >
        {#each $form.tags ?? [] as tag, index (tag)}
          <span
            class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
          >
            {tag}
            <button
              class="ml-0.5 text-primary/60 hover:text-primary"
              onclick={() => removeTag(index)}
              type="button"
            >
              &times;
            </button>
          </span>
        {/each}
        <input
          bind:this={tagInputEl}
          class="min-w-[120px] flex-1 bg-transparent py-1 text-sm outline-none"
          oninput={(e) => (tagInput = (e.target as HTMLInputElement).value)}
          onkeydown={handleTagKeyDown}
          placeholder={m.admin_tagsPlaceholder()}
          value={tagInput}
        />
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
    <button
      class="mt-2 inline-flex w-fit rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
      disabled={$submitting}
      type="submit"
    >
      {#if $submitting}
        {m.admin_updating()}
      {:else}
        {m.admin_updateProblem()}
      {/if}
    </button>
    {#if $formMessage}
      <div
        class="rounded-2xl border border-emerald-300 dark:border-emerald-700 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400"
      >
        {$formMessage}
      </div>
    {/if}
  </form>
</section>
