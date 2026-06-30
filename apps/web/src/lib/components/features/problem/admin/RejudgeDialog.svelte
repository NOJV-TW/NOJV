<script lang="ts">
  import { onDestroy } from "svelte";

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

  let workflowId = $state<string | null>(null);
  let progress = $state<{ completed: number; total: number }>({ completed: 0, total: 0 });
  let done = $state(false);
  let cancelling = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function pollOnce() {
    if (!workflowId) return;
    try {
      const res = await fetch(`/api/rejudges/${workflowId}`, {
        headers: { "X-Requested-With": "fetch" },
      });
      if (res.ok) {
        const body = (await res.json()) as { completed: number; total: number; done: boolean };
        progress = { completed: body.completed, total: body.total };
        if (body.done) {
          done = true;
          stopPolling();
        }
      }
    } catch {
      return;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => void pollOnce(), 1500);
  }

  async function handleCancel() {
    if (!workflowId || cancelling) return;
    cancelling = true;
    try {
      const res = await fetch(`/api/rejudges/${workflowId}/cancel`, {
        method: "POST",
        headers: { "X-Requested-With": "fetch" },
      });
      if (res.ok) {
        toasts.add({ type: "success", message: m.rejudge_toast_cancelled() });
        done = true;
        stopPolling();
      } else {
        toasts.add({ type: "error", message: m.rejudge_toast_error() });
      }
    } catch {
      toasts.add({ type: "error", message: m.rejudge_toast_error() });
    } finally {
      cancelling = false;
    }
  }

  function reset() {
    error = null;
    stopPolling();
    workflowId = null;
    progress = { completed: 0, total: 0 };
    done = false;
    cancelling = false;
  }

  function handleOpenChange(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  onDestroy(stopPolling);

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
        progress = { completed: 0, total: 0 };
        done = false;
        startPolling();
      } else {
        let msg: string = m.rejudge_toast_error();
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        if (body?.message) msg = body.message;
        error = msg;
        toasts.add({ type: "error", message: msg });
      }
    } catch {
      error = m.rejudge_toast_error();
      toasts.add({ type: "error", message: m.rejudge_toast_error() });
    } finally {
      submitting = false;
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
        {workflowId ? m.rejudge_progress_queued() : scopeDescription()}
      </Dialog.Description>
    </Dialog.Header>

    {#if workflowId}
      <div class="space-y-4">
        <div class="flex items-center justify-between text-body-sm">
          <span class="font-medium">
            {done ? m.rejudge_progress_done() : m.rejudge_progress_running()}
          </span>
          <span class="tabular-nums text-muted-foreground">
            {m.rejudge_progress_status({
              completed: progress.completed,
              total: progress.total,
            })}
          </span>
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            class="h-full rounded-full bg-success transition-[width] duration-300 ease-out"
            style="width: {done ? 100 : percent}%"
          ></div>
        </div>

        <Dialog.Footer>
          {#if !done}
            <Button
              type="button"
              variant="destructive"
              onclick={handleCancel}
              loading={cancelling}
              disabled={cancelling}
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
