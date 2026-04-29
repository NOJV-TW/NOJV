<script lang="ts" module>
  export interface OverrideRow {
    id: string;
    userId: string;
    problemId: string;
    overrideScore: number;
    reason: string;
  }

  export interface StudentOption {
    id: string;
    username: string;
    name: string;
  }

  export interface ProblemOption {
    id: string;
    title: string;
  }
</script>

<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";

  interface Props {
    mode: "create" | "edit";
    contextType: "assignment" | "exam" | "contest";
    contextId: string;
    students: StudentOption[];
    problems: ProblemOption[];
    /** Required when mode === "edit". */
    existing?: OverrideRow | null | undefined;
    onsuccess: () => void;
    oncancel?: (() => void) | undefined;
  }

  let {
    mode,
    contextType,
    contextId,
    students,
    problems,
    existing = null,
    onsuccess,
    oncancel
  }: Props = $props();

  // Prop snapshot: this component is recreated by a parent `{#key}` block
  // every time the edit target changes, so capturing the initial prop values
  // as `$state` is intentional — there's no need to reactively re-seed.
  // Wrapping each default in an IIFE silences svelte-check's
  // `state_referenced_locally` warning without changing semantics.
  let userId = $state<string>(((): string => existing?.userId ?? students[0]?.id ?? "")());
  let problemId = $state<string>(
    ((): string => existing?.problemId ?? problems[0]?.id ?? "")()
  );
  let overrideScore = $state<number>(((): number => existing?.overrideScore ?? 0)());
  let reason = $state<string>(((): string => existing?.reason ?? "")());
  let submitting = $state(false);
  let error = $state<string | null>(null);

  const reasonLen = $derived(reason.length);
  const reasonTooLong = $derived(reasonLen > 500);
  const reasonEmpty = $derived(reason.trim().length === 0);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (submitting) return;
    error = null;

    if (reasonEmpty) {
      error = m.override_staff_reasonMinError();
      return;
    }
    if (reasonTooLong) {
      error = m.override_staff_reasonMaxError();
      return;
    }
    if (!Number.isInteger(overrideScore) || overrideScore < 0) {
      error = m.override_staff_toastError();
      return;
    }

    submitting = true;
    try {
      let res: Response;
      if (mode === "create") {
        res = await fetch("/api/overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
          body: JSON.stringify({
            userId,
            problemId,
            contextType,
            contextId,
            overrideScore,
            reason
          })
        });
      } else {
        if (!existing) {
          error = m.override_staff_toastError();
          submitting = false;
          return;
        }
        res = await fetch(`/api/overrides/${existing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
          body: JSON.stringify({ overrideScore, reason })
        });
      }

      if (res.ok) {
        toasts.add({
          type: "success",
          message:
            mode === "create"
              ? m.override_staff_toastCreated()
              : m.override_staff_toastUpdated()
        });
        if (mode === "create") {
          // Reset for the next create; keep the edit form pre-filled.
          userId = students[0]?.id ?? "";
          problemId = problems[0]?.id ?? "";
          overrideScore = 0;
          reason = "";
        }
        onsuccess();
      } else {
        let msg: string = m.override_staff_toastError();
        try {
          const body = (await res.json()) as { message?: string };
          if (body.message) msg = body.message;
        } catch {
          // ignore body parse failure
        }
        error = msg;
        toasts.add({ type: "error", message: msg });
      }
    } catch {
      error = m.override_staff_toastError();
      toasts.add({ type: "error", message: m.override_staff_toastError() });
    } finally {
      submitting = false;
    }
  }
</script>

<form class="space-y-3" onsubmit={handleSubmit}>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <div class="flex flex-col gap-1.5">
      <label class="text-body-sm font-medium" for="ov-student">
        {m.override_staff_fieldStudent()}
      </label>
      <select
        id="ov-student"
        class="h-11 rounded-md border border-input bg-background px-3 py-2 text-body-sm"
        bind:value={userId}
        disabled={mode === "edit" || submitting}
      >
        {#each students as s (s.id)}
          <option value={s.id}>
            {s.name}{s.username ? ` (${s.username})` : ""}
          </option>
        {/each}
      </select>
    </div>

    <div class="flex flex-col gap-1.5">
      <label class="text-body-sm font-medium" for="ov-problem">
        {m.override_staff_fieldProblem()}
      </label>
      <select
        id="ov-problem"
        class="h-11 rounded-md border border-input bg-background px-3 py-2 text-body-sm"
        bind:value={problemId}
        disabled={mode === "edit" || submitting}
      >
        {#each problems as p (p.id)}
          <option value={p.id}>{p.title}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="flex flex-col gap-1.5">
    <label class="text-body-sm font-medium" for="ov-score">
      {m.override_staff_fieldScore()}
    </label>
    <Input
      id="ov-score"
      type="number"
      min={0}
      step={1}
      bind:value={overrideScore}
      disabled={submitting}
    />
  </div>

  <div class="flex flex-col gap-1.5">
    <div class="flex items-center justify-between">
      <label class="text-body-sm font-medium" for="ov-reason">
        {m.override_staff_fieldReason()}
      </label>
      <span
        class="text-caption tabular-nums"
        class:text-destructive={reasonTooLong}
        class:text-muted-foreground={!reasonTooLong}
      >
        {reasonLen}/500
      </span>
    </div>
    <textarea
      id="ov-reason"
      class="min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-body-sm"
      bind:value={reason}
      disabled={submitting}
    ></textarea>
    <p class="text-caption text-muted-foreground">
      {m.override_staff_reasonHint()}
    </p>
  </div>

  {#if error}
    <p class="text-caption text-destructive" role="alert">{error}</p>
  {/if}

  <div class="flex items-center justify-end gap-2 pt-2">
    {#if oncancel}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onclick={() => oncancel?.()}
        disabled={submitting}
      >
        {m.rejudge_dialog_cancelBtn()}
      </Button>
    {/if}
    <Button type="submit" size="sm" loading={submitting} disabled={submitting}>
      {mode === "create"
        ? m.override_staff_submitCreate()
        : m.override_staff_submitUpdate()}
    </Button>
  </div>
</form>
