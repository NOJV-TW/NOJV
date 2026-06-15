<script lang="ts">
  import { onDestroy } from "svelte";

  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import { Button } from "$lib/components/primitives/ui/button";
  import { Input } from "$lib/components/primitives/ui/input";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";

  type ContextType = "" | "contest" | "assignment" | "exam";

  interface Props {
    problemId: string;
    open: boolean;
    onOpenChange: (v: boolean) => void;
  }

  let { problemId, open, onOpenChange }: Props = $props();

  let contextType = $state<ContextType>("");
  let contextId = $state("");
  let userIds = $state("");
  let since = $state("");
  let until = $state("");
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
    contextType = "";
    contextId = "";
    userIds = "";
    since = "";
    until = "";
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

  function validate(): string | null {
    if (contextType !== "" && contextId.trim() === "") {
      return "Context id is required when a context type is selected.";
    }
    if (since !== "" && until !== "") {
      if (since >= until) return '"Since" must be earlier than "Until".';
    }
    return null;
  }

  function toIsoOrUndef(v: string): string | undefined {
    if (!v) return undefined;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (submitting) return;

    const v = validate();
    if (v) {
      error = v;
      return;
    }
    error = null;

    const ids = userIds
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const payload: Record<string, unknown> = {
      problemId,
    };
    if (contextType === "contest") payload.contestId = contextId.trim();
    if (contextType === "assignment") payload.assessmentId = contextId.trim();
    if (contextType === "exam") payload.examId = contextId.trim();
    if (ids.length > 0) payload.userIds = ids;
    const sinceIso = toIsoOrUndef(since);
    const untilIso = toIsoOrUndef(until);
    if (sinceIso) payload.since = sinceIso;
    if (untilIso) payload.until = untilIso;

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
        {workflowId ? m.rejudge_progress_queued() : m.rejudge_dialog_filterCtx()}
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
        <div class="flex flex-col gap-1.5">
          <label class="text-body-sm font-medium" for="rejudge-context-type">
            {m.rejudge_dialog_filterCtx()}
          </label>
          <select
            id="rejudge-context-type"
            class="h-11 rounded-md border border-input bg-background px-3 py-2 text-body-sm"
            bind:value={contextType}
            disabled={submitting}
          >
            <option value="">{m.rejudge_dialog_contextType_all()}</option>
            <option value="contest">{m.rejudge_dialog_contextType_contest()}</option>
            <option value="assignment">{m.rejudge_dialog_contextType_assignment()}</option>
            <option value="exam">{m.rejudge_dialog_contextType_exam()}</option>
          </select>
        </div>

        {#if contextType !== ""}
          <div class="flex flex-col gap-1.5">
            <label class="text-body-sm font-medium" for="rejudge-context-id">
              {m.rejudge_dialog_contextId()}
            </label>
            <Input
              id="rejudge-context-id"
              bind:value={contextId}
              placeholder="cuid…"
              disabled={submitting}
            />
          </div>
        {/if}

        <div class="flex flex-col gap-1.5">
          <label class="text-body-sm font-medium" for="rejudge-user-ids">
            {m.rejudge_dialog_userIds()}
          </label>
          <Input id="rejudge-user-ids" bind:value={userIds} disabled={submitting} />
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <label class="text-body-sm font-medium" for="rejudge-since">
              {m.rejudge_dialog_since()}
            </label>
            <Input
              id="rejudge-since"
              type="datetime-local"
              bind:value={since}
              disabled={submitting}
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-body-sm font-medium" for="rejudge-until">
              {m.rejudge_dialog_until()}
            </label>
            <Input
              id="rejudge-until"
              type="datetime-local"
              bind:value={until}
              disabled={submitting}
            />
          </div>
        </div>

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
