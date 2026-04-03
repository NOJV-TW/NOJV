<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { superForm } from "sveltekit-superforms";
  import { m } from "$lib/paraglide/messages.js";
  import { inputClassName } from "$lib/utils";

  let { data } = $props();

  const { form, errors, submitting, enhance } = superForm(untrack(() => data.form), {
    dataType: "json",
    onResult({ result }) {
      if (result.type === "success" && result.data) {
        const slug = String(result.data.slug ?? "");
        if (slug) {
          void goto(`/problems/${slug}/edit`);
        }
      }
    }
  });

  // Auto-generate slug from title
  $effect(() => {
    const title = $form.title;
    untrack(() => {
      if (title) {
        const rawSlug = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        const newSlug = rawSlug.length >= 3 ? rawSlug : `problem-${String(Date.now())}`;
        if ($form.slug !== newSlug) {
          $form.slug = newSlug;
        }
      }
    });
  });
</script>

<div class="mx-auto max-w-2xl space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">
    {m.problems_createNew()}
  </h2>

  <section class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm">
    <form class="grid gap-4" method="POST" action="?/create" use:enhance>
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

      <!-- Slug (auto-generated, editable) -->
      <label class="text-sm text-muted-foreground">
        {m.admin_slug()}
        <input
          class={inputClassName}
          bind:value={$form.slug}
          required
        />
        {#if $errors.slug}<span class="text-sm text-red-700 dark:text-red-400">{$errors.slug}</span>{/if}
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

      <!-- Summary -->
      <label class="text-sm text-muted-foreground">
        {m.admin_summaryLabel()}
        <textarea
          class="{inputClassName} min-h-20 resize-y"
          bind:value={$form.summary}
        ></textarea>
      </label>

      <!-- Statement -->
      <label class="text-sm text-muted-foreground">
        {m.admin_statement()} ({m.admin_statementMarkdown()})
        <textarea
          class="{inputClassName} min-h-40 resize-y"
          bind:value={$form.statement}
          required
        ></textarea>
        {#if $errors.statement}<span class="text-sm text-red-700 dark:text-red-400">{$errors.statement}</span>{/if}
      </label>

      <!-- Submit -->
      <button
        class="mt-2 inline-flex w-fit rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={$submitting}
        type="submit"
      >
        {#if $submitting}
          {m.common_creating()}
        {:else}
          {m.admin_createProblem()}
        {/if}
      </button>
    </form>
  </section>
</div>
