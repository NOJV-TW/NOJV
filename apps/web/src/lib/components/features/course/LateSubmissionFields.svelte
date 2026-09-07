<script lang="ts">
  import type { LatePenaltyRule } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { inputClassName } from "$lib/utils/css";
  import LatePenaltyRuleBuilder from "./LatePenaltyRuleBuilder.svelte";

  interface Props {
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

<div class="space-y-5" data-slot="late-submission-fields">
  <div>
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
    {#if dueErrors}
      <p id="dueAt-error" class="mt-1 text-caption text-destructive">
        {m.lateSubmission_dueError()}
      </p>
    {/if}
  </div>
  <div>
    <label class="flex items-center gap-2 text-sm font-medium">
      <input
        name="allowLateSubmissions"
        type="checkbox"
        bind:checked={allowLateSubmissions}
        disabled={!editablePolicy}
        onchange={(event) => {
          if (!event.currentTarget.checked) latePenalty = null;
        }}
      />
      {m.lateSubmission_allowLabel()}
    </label>
    <p class="mt-1 text-caption text-muted-foreground">{m.lateSubmission_allowHint()}</p>
  </div>
  {#if allowLateSubmissions}
    <div>
      <label class="text-sm font-medium" for={finalName}>{m.lateSubmission_finalLabel()}</label>
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
      {#if finalErrors}
        <p id={`${finalName}-error`} class="mt-1 text-caption text-destructive">
          {m.lateSubmission_finalError()}
        </p>
      {/if}
      {#if exam}<p class="mt-1 text-caption text-muted-foreground">
          {m.lateSubmission_examHint()}
        </p>{/if}
    </div>
    <div>
      <label class="text-sm font-medium" for="late-penalty-rule"
        >{m.assignmentCreate_latePenaltyLabel()}</label
      >
      <div class="mt-2">
        <LatePenaltyRuleBuilder
          value={latePenalty}
          onChange={(value) => (latePenalty = value)}
          disabled={!editablePolicy || !pointsBased}
        />
      </div>
      {#if !pointsBased}<p class="mt-1 text-caption text-muted-foreground">
          {m.lateSubmission_pointsOnly()}
        </p>{/if}
      {#if penaltyInvalid}<p class="mt-1 text-caption text-destructive">
          {m.lateSubmission_penaltyError()}
        </p>{/if}
    </div>
  {/if}
</div>
