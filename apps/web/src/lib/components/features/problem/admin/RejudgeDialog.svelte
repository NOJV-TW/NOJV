<script lang="ts">
  import { onDestroy } from "svelte";
  import { z } from "zod";
  import type { RejudgeProgress } from "@nojv/core";

  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import { Button } from "$lib/components/primitives/ui/button";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";

  type RejudgeScope =
    | { type: "practice" }
    | { type: "assignment"; id: string }
    | { type: "exam"; id: string }
    | { type: "contest"; id: string };

  interface Props {
    problemId: string;
    open: boolean;
    scope?: RejudgeScope;
    onOpenChange: (v: boolean) => void;
  }

  let { problemId, open, scope = { type: "practice" }, onOpenChange }: Props = $props();

  let submitting = $state(false);
  let error = $state<string | null>(null);

  const progressSchema = z.object({
    status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  });

  let workflowId = $state<string | null>(null);
  let progress = $state<RejudgeProgress>({ status: "queued", completed: 0, total: 0 });
  let done = $derived(
    progress.status === "completed" ||
      progress.status === "failed" ||
      progress.status === "cancelled",
  );
  let cancelling = $state(false);
  let cancellationRequested = $state(false);
  let queryError = $state<string | null>(null);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  async function pollOnce() {
    const id = workflowId;
    if (!id || disposed) return;
    try {
      const res = await fetch(`/api/rejudges/${id}`, {
        headers: { "X-Requested-With": "fetch" },
      });
      if (!res.ok) throw new Error(m.rejudge_progress_unavailable());
      const next = progressSchema.parse(await res.json());
      if (workflowId !== id || disposed) return;
      progress = next;
      queryError = null;
    } catch {
      if (workflowId === id && !disposed) queryError = m.rejudge_progress_unavailable();
    } finally {
      if (workflowId === id && !disposed && !done) {
        pollTimer = setTimeout(() => void pollOnce(), 1500);
      }
    }
  }

  function startPolling() {
    stopPolling();
    void pollOnce();
  }

  async function handleCancel() {
    const id = workflowId;
    if (!id || cancelling || cancellationRequested) return;
    cancelling = true;
    try {
      const res = await fetch(`/api/rejudges/${id}/cancel`, {
        method: "POST",
        headers: { "X-Requested-With": "fetch" },
      });
      if (!res.ok) throw new Error(m.rejudge_toast_error());
      if (workflowId !== id || disposed) return;
      cancellationRequested = true;
      toasts.success(m.rejudge_cancel_requested());
    } catch {
      toasts.error(m.rejudge_toast_error());
    } finally {
      cancelling = false;
    }
  }

  function reset() {
    error = null;
    stopPolling();
    workflowId = null;
    progress = { status: "queued", completed: 0, total: 0 };
    queryError = null;
    cancellationRequested = false;
    cancelling = false;
  }

  function handleOpenChange(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  onDestroy(() => {
    disposed = true;
    stopPolling();
  });

  function scopeDescription(): string {
    if (scope.type === "practice") return m.rejudge_dialog_problemScope();
    if (scope.type === "assignment") return m.rejudge_dialog_assignmentScope();
    if (scope.type === "exam") return m.rejudge_dialog_examScope();
    return m.rejudge_dialog_contestScope();
  }

  function applyScope(payload: Record<string, unknown>) {
    if (scope.type === "assignment") payload.assessmentId = scope.id;
    if (scope.type === "exam") payload.examId = scope.id;
    if (scope.type === "contest") payload.contestId = scope.id;
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (submitting) return;

    error = null;

    const payload: Record<string, unknown> = {
      problemId,
    };
    applyScope(payload);

    submitting = true;
    try {
      const res = await fetch("/api/rejudges", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const body = (await res.json()) as { workflowId: string };
        workflowId = body.workflowId;
        progress = { status: "queued", completed: 0, total: 0 };
        startPolling();
      } else {
        let msg: string = m.rejudge_toast_error();
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        if (body?.message) msg = body.message;
        error = msg;
        toasts.error(msg);
      }
    } catch {
      error = m.rejudge_toast_error();
      toasts.error(m.rejudge_toast_error());
    } finally {
      submitting = false;
    }
  }

  function progressLabel() {
    switch (progress.status) {
      case "queued":
        return m.rejudge_progress_queued();
      case "running":
        return m.rejudge_progress_running();
      case "completed":
        return m.rejudge_progress_done();
      case "failed":
        return m.rejudge_progress_failed();
      case "cancelled":
        return m.rejudge_progress_cancelled();
    }
  }

  let percent = $derived(
    progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0,
  );
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Content showCloseButton>
    <Dialog.Header>
      <Dialog.Title>{m.rejudge_dialog_title()}</Dialog.Title>
      <Dialog.Description>
        {scopeDescription()}
      </Dialog.Description>
    </Dialog.Header>

    {#if workflowId}
      <div class="space-y-4">
        {#if queryError}
          <p class="text-caption text-destructive" role="alert">{queryError}</p>
        {/if}
        {#if cancellationRequested && !done}
          <p class="text-caption text-muted-foreground" role="status">
            {m.rejudge_cancel_requested()}
          </p>
        {/if}
        <div class="flex items-center justify-between text-body-sm">
          <span class="font-medium">
            {progressLabel()}
          </span>
          <span class="tabular-nums text-muted-foreground">
            {m.rejudge_progress_status({
              completed: progress.completed,
              total: progress.total,
            })}
          </span>
        </div>
        <div
          class="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={progressLabel()}
          aria-valuemin="0"
          aria-valuemax={progress.total || 1}
          aria-valuenow={progress.completed}
        >
          <div
            class="h-full rounded-full bg-success transition-[width] duration-300 ease-out"
            style="width: {percent}%"
          ></div>
        </div>

        <Dialog.Footer>
          {#if !done}
            <Button
              type="button"
              variant="destructive"
              onclick={handleCancel}
              loading={cancelling}
              disabled={cancelling || cancellationRequested}
            >
              {m.rejudge_progress_cancelBtn()}
            </Button>
          {/if}
          <Button type="button" variant="outline" onclick={() => handleOpenChange(false)}>
            {m.rejudge_progress_closeBtn()}
          </Button>
        </Dialog.Footer>
      </div>
    {:else}
      <form class="space-y-4" onsubmit={handleSubmit}>
        {#if error}
          <p class="text-caption text-destructive" role="alert">{error}</p>
        {/if}

        <Dialog.Footer>
          <Button
            type="button"
            variant="outline"
            onclick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            {m.rejudge_dialog_cancelBtn()}
          </Button>
          <Button type="submit" loading={submitting} disabled={submitting}>
            {m.rejudge_dialog_submitBtn()}
          </Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
