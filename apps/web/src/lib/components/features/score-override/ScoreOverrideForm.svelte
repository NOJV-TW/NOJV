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
  import { untrack } from "svelte";
  import { Button } from "$lib/components/primitives/ui/button";
  import { Input } from "$lib/components/primitives/ui/input";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";

  interface Props {
    mode: "create" | "edit";
    contextType: "assignment" | "exam" | "contest";
    contextId: string;
    students: StudentOption[];
    problems: ProblemOption[];
    existing?: OverrideRow | null | undefined;
    initialUserId?: string | undefined;
    initialProblemId?: string | undefined;
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
    initialUserId,
    initialProblemId,
    onsuccess,
    oncancel,
  }: Props = $props();

  let userId = $state(
    untrack(() => existing?.userId ?? initialUserId ?? students[0]?.id ?? ""),
  );
  let problemId = $state(
    untrack(() => existing?.problemId ?? initialProblemId ?? problems[0]?.id ?? ""),
  );
  let overrideScore = $state(untrack(() => existing?.overrideScore ?? 0));
  let reason = $state(untrack(() => existing?.reason ?? ""));
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
        const context =
          contextType === "assignment"
            ? { type: contextType, assignmentId: contextId }
            : contextType === "exam"
              ? { type: contextType, examId: contextId }
              : { type: contextType, contestId: contextId };
        res = await fetch("/api/overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
          body: JSON.stringify({
            userId,
            problemId,
            context,
            overrideScore,
            reason,
          }),
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
          body: JSON.stringify({ overrideScore, reason }),
        });
      }

      if (res.ok) {
        toasts.add({
          type: "success",
          message:
            mode === "create"
              ? m.override_staff_toastCreated()
              : m.override_staff_toastUpdated(),
        });
        if (mode === "create") {
          userId = students[0]?.id ?? "";
          problemId = problems[0]?.id ?? "";
          overrideScore = 0;
          reason = "";
        }
        onsuccess();
      } else {
        let msg: string = m.override_staff_toastError();
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        if (body?.message) msg = body.message;
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
      aria-invalid={error != null}
      aria-describedby={error != null ? "ov-error" : undefined}
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
      aria-invalid={error != null}
      aria-describedby={error != null ? "ov-error" : undefined}></textarea>
    <p class="text-caption text-muted-foreground">
      {m.override_staff_reasonHint()}
    </p>
  </div>

  {#if error}
    <p id="ov-error" class="text-caption text-destructive" role="alert">{error}</p>
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
        {m.common_cancel()}
      </Button>
    {/if}
    <Button type="submit" size="sm" loading={submitting} disabled={submitting}>
      {mode === "create" ? m.override_staff_submitCreate() : m.override_staff_submitUpdate()}
    </Button>
  </div>
</form>
