<script lang="ts">
  import { untrack } from "svelte";
  import { superForm } from "sveltekit-superforms";
  import { m } from "$lib/paraglide/messages.js";
  import { supportedLanguages, type Language, type SubmissionType } from "@nojv/core";
  import type { ProblemDetail, TemplateInfo } from "$lib/types";
  import { inputClassName, monoTextareaClassName } from "$lib/utils";
  import CodeTemplateEditor from "$lib/components/problem/CodeTemplateEditor.svelte";
  import HelpTooltip from "$lib/components/ui/HelpTooltip.svelte";

  interface Props {
    problem: ProblemDetail;
    formData: any;
  }

  let { problem, formData }: Props = $props();

  const { form, errors, submitting, message: formMessage, enhance } = superForm(untrack(() => formData), {
    dataType: 'json',
  });

  // Template data (for function mode)
  let templatesByLang = $state<Partial<Record<Language, TemplateInfo>>>(
    problem.templates ? { ...problem.templates } : {}
  );

  // Populate templates into form data before submission
  let prevTemplateSyncKey = "";
  $effect(() => {
    const submissionType = $form.submissionType;
    const tpl = templatesByLang;
    const syncKey = JSON.stringify({ submissionType, tpl });
    if (syncKey === prevTemplateSyncKey) return;
    prevTemplateSyncKey = syncKey;
    untrack(() => {
      if (submissionType === "function") {
        $form.templates = supportedLanguages
          .filter((lang) => tpl[lang]?.driverCode)
          .map((lang) => ({
            driverCode: tpl[lang]!.driverCode,
            insertionMarker: tpl[lang]!.insertionMarker || "// __USER_CODE__",
            language: lang,
            templateCode: tpl[lang]!.templateCode,
          }));
      } else {
        $form.templates = [];
      }
    });
  });
</script>

<form class="grid gap-6" method="POST" action="?/updateSubmission" use:enhance>
  <!-- Submission Type -->
  <div class="text-sm text-muted-foreground">
    <span>{m.admin_submissionType()} <HelpTooltip text={m.admin_helpSubmissionType()} /></span>
    <div class="mt-2 flex gap-4">
      <label class="flex items-center gap-2 text-sm">
        <input
          checked={$form.submissionType === "full_source"}
          class="accent-primary"
          name="submissionType"
          onchange={() => ($form.submissionType = "full_source" as SubmissionType)}
          type="radio"
          value="full_source"
        />
        {m.admin_fullSource()}
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input
          checked={$form.submissionType === "function"}
          class="accent-primary"
          name="submissionType"
          onchange={() => ($form.submissionType = "function" as SubmissionType)}
          type="radio"
          value="function"
        />
        {m.admin_functionTemplate()}
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input
          checked={$form.submissionType === "zip_project"}
          class="accent-primary"
          name="submissionType"
          onchange={() => ($form.submissionType = "zip_project" as SubmissionType)}
          type="radio"
          value="zip_project"
        />
        {m.admin_zipProject()}
      </label>
    </div>
    {#if $errors.submissionType}<span class="text-sm text-red-700 dark:text-red-400">{$errors.submissionType}</span>{/if}
  </div>

  <!-- Time / Memory Limits -->
  <div class="grid gap-4 md:grid-cols-2">
    <label class="text-sm text-muted-foreground">
      {m.admin_timeLimit()}
      <input
        class={inputClassName}
        min="100"
        max="30000"
        bind:value={$form.timeLimitMs}
        type="number"
      />
      {#if $errors.timeLimitMs}<span class="text-sm text-red-700 dark:text-red-400">{$errors.timeLimitMs}</span>{/if}
    </label>
    <label class="text-sm text-muted-foreground">
      {m.admin_memoryLimit()}
      <input
        class={inputClassName}
        min="16"
        max="1024"
        bind:value={$form.memoryLimitMb}
        type="number"
      />
      {#if $errors.memoryLimitMb}<span class="text-sm text-red-700 dark:text-red-400">{$errors.memoryLimitMb}</span>{/if}
    </label>
  </div>

  <!-- Function mode: CodeTemplateEditor -->
  {#if $form.submissionType === "function"}
    <CodeTemplateEditor
      submissionType={$form.submissionType ?? "full_source"}
      bind:templatesByLang
    />
  {/if}

  <!-- ZIP Project mode: additional fields -->
  {#if $form.submissionType === "zip_project"}
    <div class="border-t border-border pt-5">
      <label class="text-sm text-muted-foreground">
        {m.admin_zipFileStructure()}
        <textarea
          class="{monoTextareaClassName} min-h-32"
          bind:value={$form.zipFileStructure}
          placeholder={m.admin_zipFileStructurePlaceholder()}
        ></textarea>
      </label>

      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <label class="text-sm text-muted-foreground">
          {m.admin_zipCompileCommand()}
          <input
            class={inputClassName}
            bind:value={$form.zipCompileCommand}
            placeholder={m.admin_zipCompileCommandPlaceholder()}
          />
        </label>
        <label class="text-sm text-muted-foreground">
          {m.admin_zipEntryPoint()}
          <input
            class={inputClassName}
            bind:value={$form.zipEntryPoint}
            placeholder={m.admin_zipEntryPointPlaceholder()}
          />
        </label>
      </div>
    </div>
  {/if}

  <!-- Submit -->
  <button
    class="mt-2 inline-flex w-fit rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
    disabled={$submitting}
    type="submit"
  >
    {#if $submitting}
      {m.admin_updating()}
    {:else}
      {m.admin_updateSubmission()}
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
