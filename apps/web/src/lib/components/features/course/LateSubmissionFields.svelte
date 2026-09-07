<script lang="ts">
  import type { Snippet } from "svelte";
  import type { LatePenaltyRule } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { inputClassName } from "$lib/utils/css";
  import LatePenaltyRuleBuilder from "./LatePenaltyRuleBuilder.svelte";

  interface Props {
    startField?: Snippet;
    dueAt: string;
    finalAt: string;
    allowLateSubmissions: boolean;
    latePenalty: LatePenaltyRule | null;
    finalName: "closesAt" | "endsAt";
    dueErrors?: string[] | undefined;
    finalErrors?: string[] | undefined;
    penaltyInvalid?: boolean;
    editablePolicy?: boolean;
    editableEnd?: boolean;
    editableDue?: boolean;
    pointsBased?: boolean;
    exam?: boolean;
  }

  let {
    startField,
    dueAt = $bindable(),
    finalAt = $bindable(),
    allowLateSubmissions = $bindable(),
    latePenalty = $bindable(),
    finalName,
    dueErrors,
    finalErrors,
    penaltyInvalid = false,
    editablePolicy = true,
    editableEnd = true,
    editableDue = editablePolicy,
    pointsBased = true,
    exam = false,
  }: Props = $props();
</script>

<div class="@container space-y-6" data-slot="late-submission-fields">
  <div class="grid gap-5 @xl:grid-cols-2">
    {@render startField?.()}
    <div class="min-w-0">
      <label class="text-sm font-medium" for="dueAt">{m.lateSubmission_dueLabel()}</label>
      <input
        id="dueAt"
        name="dueAt"
        type="datetime-local"
        class={inputClassName}
        bind:value={dueAt}
        disabled={!editableDue}
        required
        aria-invalid={dueErrors ? "true" : undefined}
        aria-describedby={dueErrors ? "dueAt-error" : undefined}
      />
      {#if dueErrors}<p id="dueAt-error" class="mt-1 text-caption text-destructive">
          {m.lateSubmission_dueError()}
        </p>{/if}
    </div>
  </div>

  <div class="space-y-5 border-t border-border-subtle pt-5">
    <div class="flex items-center justify-between gap-4">
      <div>
        <label class="cursor-pointer text-sm font-medium" for="allow-late-submissions">
          {m.lateSubmission_allowLabel()}
        </label>
        <p id="allow-late-hint" class="mt-1 text-caption text-muted-foreground">
          {m.lateSubmission_allowHint()}
        </p>
      </div>
      <input
        id="allow-late-submissions"
        name="allowLateSubmissions"
        type="checkbox"
        class="size-5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed"
        bind:checked={allowLateSubmissions}
        disabled={!editablePolicy}
        aria-describedby="allow-late-hint"
        onchange={(event) => {
          if (!event.currentTarget.checked) latePenalty = null;
        }}
      />
    </div>
    {#if allowLateSubmissions}
      <div class="grid items-start gap-5 @xl:grid-cols-2">
        <div class="min-w-0">
          <label class="text-sm font-medium" for={finalName}
            >{m.lateSubmission_finalLabel()}</label
          >
          <input
            id={finalName}
            name={finalName}
            type="datetime-local"
            class={inputClassName}
            bind:value={finalAt}
            min={dueAt}
            disabled={!editableEnd}
            required
            aria-invalid={finalErrors ? "true" : undefined}
            aria-describedby={finalErrors ? `${finalName}-error` : undefined}
          />
          {#if finalErrors}<p
              id={`${finalName}-error`}
              class="mt-1 text-caption text-destructive"
            >
              {m.lateSubmission_finalError()}
            </p>{/if}
        </div>
        <div class="min-w-0">
          <label class="text-sm font-medium" for="late-penalty-rule"
            >{m.assignmentCreate_latePenaltyLabel()}</label
          >
          <LatePenaltyRuleBuilder
            value={latePenalty}
            onChange={(value) => (latePenalty = value)}
            disabled={!editablePolicy || !pointsBased}
          />
          {#if !pointsBased}<p class="mt-1 text-caption text-muted-foreground">
              {m.lateSubmission_pointsOnly()}
            </p>{/if}
          {#if penaltyInvalid}<p class="mt-1 text-caption text-destructive">
              {m.lateSubmission_penaltyError()}
            </p>{/if}
        </div>
      </div>
      {#if latePenalty?.type === "daily_late_penalty" || exam}
        <div class="space-y-1 text-caption leading-relaxed text-muted-foreground">
          {#if latePenalty?.type === "daily_late_penalty"}<p>
              {m.latePenalty_dailyHint()}
            </p>{/if}
          {#if exam}<p>{m.lateSubmission_examHint()}</p>{/if}
        </div>
      {/if}
    {/if}
  </div>
</div>
