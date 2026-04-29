<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
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

  function reset() {
    contextType = "";
    contextId = "";
    userIds = "";
    since = "";
    until = "";
    error = null;
  }

  function handleOpenChange(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  function validate(): string | null {
    if (contextType !== "" && contextId.trim() === "") {
      return "Context id is required when a context type is selected.";
    }
    if (since !== "" && until !== "") {
      // datetime-local strings are lexicographically comparable.
      if (since >= until) return "\"Since\" must be earlier than \"Until\".";
    }
    return null;
  }

  function toIsoOrUndef(v: string): string | undefined {
    if (!v) return undefined;
    // datetime-local → interpret in local TZ, then serialize as ISO.
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
      mode: "batch",
      problemId
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
      const res = await fetch("/api/rejudge", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        toasts.add({ type: "success", message: m.rejudge_toast_queuedBatch() });
        handleOpenChange(false);
      } else {
        let msg: string = m.rejudge_toast_error();
        try {
          const body = (await res.json()) as { message?: string };
          if (body.message) msg = body.message;
        } catch {
          // ignore JSON parse failure — keep default message
        }
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
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Content showCloseButton>
    <Dialog.Header>
      <Dialog.Title>{m.rejudge_dialog_title()}</Dialog.Title>
      <Dialog.Description>
        {m.rejudge_dialog_filterCtx()}
      </Dialog.Description>
    </Dialog.Header>

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
  </Dialog.Content>
</Dialog.Root>
