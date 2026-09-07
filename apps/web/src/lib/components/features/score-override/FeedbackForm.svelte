<script lang="ts" module>
  export interface FeedbackRow {
    id: string;
    courseMembershipId: string;
    problemId: string;
    comment: string;
  }
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { Button } from "$lib/components/primitives/ui/button";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";
  import type { ProblemOption, StudentOption } from "./ScoreOverrideForm.svelte";

  interface Props {
    mode: "create" | "edit";
    contextType: "assignment" | "exam";
    contextId: string;
    students: StudentOption[];
    problems: ProblemOption[];
    existing?: FeedbackRow | null | undefined;
    initialCourseMembershipId?: string | undefined;
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
    initialCourseMembershipId,
    initialProblemId,
    onsuccess,
    oncancel,
  }: Props = $props();

  let courseMembershipId = $state<string>(
    untrack(
      () =>
        existing?.courseMembershipId ??
        initialCourseMembershipId ??
        students[0]?.courseMembershipId ??
        "",
    ),
  );
  let problemId = $state<string>(
    untrack(() => existing?.problemId ?? initialProblemId ?? problems[0]?.id ?? ""),
  );
  let comment = $state(untrack(() => existing?.comment ?? ""));
  let submitting = $state(false);
  let error = $state<string | null>(null);

  const commentLen = $derived(comment.length);
  const commentTooLong = $derived(commentLen > 2000);
  const commentEmpty = $derived(comment.trim().length === 0);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (submitting) return;
    error = null;

    if (!courseMembershipId || !problemId) {
      error = m.feedback_staff_toastError();
      return;
    }
    if (commentEmpty) {
      error = m.feedback_staff_commentMinError();
      return;
    }
    if (commentTooLong) {
      error = m.feedback_staff_commentMaxError();
      return;
    }

    submitting = true;
    try {
      const context =
        contextType === "assignment"
          ? { type: contextType, assignmentId: contextId }
          : { type: contextType, examId: contextId };
      const res = await fetch("/api/feedback", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
        body: JSON.stringify({ context, courseMembershipId, problemId, comment }),
      });

      if (res.ok) {
        toasts.success(
          mode === "create" ? m.feedback_staff_toastCreated() : m.feedback_staff_toastUpdated(),
        );
        if (mode === "create") {
          courseMembershipId = students[0]?.courseMembershipId ?? "";
          problemId = problems[0]?.id ?? "";
          comment = "";
        }
        onsuccess();
      } else {
        let msg: string = m.feedback_staff_toastError();
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        if (body?.message) msg = body.message;
        error = msg;
        toasts.error(msg);
      }
    } catch {
      error = m.feedback_staff_toastError();
      toasts.error(m.feedback_staff_toastError());
    } finally {
      submitting = false;
    }
  }
</script>

<form class="space-y-3" onsubmit={handleSubmit}>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <div class="flex flex-col gap-1.5">
      <label class="text-body-sm font-medium" for="fb-student">
        {m.feedback_staff_fieldStudent()}
      </label>
      <select
        id="fb-student"
        class="h-11 rounded-md border border-input bg-background px-3 py-2 text-body-sm"
        bind:value={courseMembershipId}
        disabled={mode === "edit" || submitting}
      >
        {#each students as s (s.rowId)}
          {#if s.courseMembershipId}
            <option value={s.courseMembershipId}>
              {s.name}{s.username ? ` (${s.username})` : ""}{s.userId === null
                ? ` · ${m.members_pendingActivation()}`
                : ""}
            </option>
          {/if}
        {/each}
      </select>
    </div>

    <div class="flex flex-col gap-1.5">
      <label class="text-body-sm font-medium" for="fb-problem">
        {m.feedback_staff_fieldProblem()}
      </label>
      <select
        id="fb-problem"
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
    <div class="flex items-center justify-between">
      <label class="text-body-sm font-medium" for="fb-comment">
        {m.feedback_staff_fieldComment()}
      </label>
      <span
        class="text-caption tabular-nums"
        class:text-destructive={commentTooLong}
        class:text-muted-foreground={!commentTooLong}
      >
        {commentLen}/2000
      </span>
    </div>
    <textarea
      id="fb-comment"
      class="min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-body-sm"
      bind:value={comment}
      disabled={submitting}></textarea>
    <p class="text-caption text-muted-foreground">
      {m.feedback_staff_commentHint()}
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
      {mode === "create" ? m.feedback_staff_submitCreate() : m.feedback_staff_submitUpdate()}
    </Button>
  </div>
</form>
