<script lang="ts">
  import { toasts } from "$lib/stores/toast";
  import { Button } from "$lib/components/primitives/ui/button";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDateTime } from "$lib/utils/datetime";
  import type { FeedbackRow } from "./FeedbackForm.svelte";
  import type { ProblemOption, StudentOption } from "./ScoreOverrideForm.svelte";

  export interface FeedbackListRow extends FeedbackRow {
    updatedAt: string;
  }

  interface Props {
    rows: FeedbackListRow[];
    students: StudentOption[];
    problems: ProblemOption[];
    onedit: (row: FeedbackListRow) => void;
    ondelete: () => void;
  }

  let { rows, students, problems, onedit, ondelete }: Props = $props();

  const studentById = $derived(new Map(students.map((s) => [s.id, s])));
  const problemById = $derived(new Map(problems.map((p) => [p.id, p])));

  let pendingDeleteId = $state<string | null>(null);
  let deleting = $state(false);

  function studentLabel(userId: string): string {
    const s = studentById.get(userId);
    if (!s) return userId;
    return s.username ? `${s.name} (${s.username})` : s.name;
  }

  function problemTitle(problemId: string): string {
    return problemById.get(problemId)?.title ?? problemId;
  }

  function truncate(s: string, n: number): string {
    if (s.length <= n) return s;
    return `${s.slice(0, n)}…`;
  }

  async function confirmDelete() {
    if (!pendingDeleteId || deleting) return;
    deleting = true;
    const id = pendingDeleteId;
    try {
      const res = await fetch(`/api/feedback/${id}`, {
        method: "DELETE",
        headers: { "X-Requested-With": "fetch" },
      });
      if (res.ok) {
        toasts.add({ type: "success", message: m.feedback_staff_toastDeleted() });
        ondelete();
      } else {
        toasts.add({ type: "error", message: m.feedback_staff_toastError() });
      }
    } catch {
      toasts.add({ type: "error", message: m.feedback_staff_toastError() });
    } finally {
      deleting = false;
      pendingDeleteId = null;
    }
  }
</script>

{#if rows.length === 0}
  <div
    class="rounded-md border border-dashed border-border-strong bg-[color:var(--color-panel)]/40 px-4 py-6 text-center text-caption text-muted-foreground"
  >
    {m.feedback_staff_emptyList()}
  </div>
{:else}
  <div class="overflow-hidden rounded-md border border-border">
    <table class="w-full text-body-sm">
      <thead class="bg-muted/40 text-caption uppercase tracking-wide text-muted-foreground">
        <tr>
          <th class="px-3 py-2 text-left font-medium">
            {m.feedback_staff_fieldStudent()}
          </th>
          <th class="px-3 py-2 text-left font-medium">
            {m.feedback_staff_fieldProblem()}
          </th>
          <th class="px-3 py-2 text-left font-medium">
            {m.feedback_staff_fieldComment()}
          </th>
          <th class="px-3 py-2 text-left font-medium"></th>
          <th class="px-3 py-2 text-right font-medium"></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.id)}
          <tr class="border-t border-border-subtle">
            <td class="px-3 py-2">{studentLabel(row.studentUserId)}</td>
            <td class="px-3 py-2">{problemTitle(row.problemId)}</td>
            <td class="px-3 py-2 text-muted-foreground" title={row.comment}>
              {truncate(row.comment, 40)}
            </td>
            <td class="px-3 py-2 text-muted-foreground tabular-nums">
              {formatDateTime(row.updatedAt)}
            </td>
            <td class="px-3 py-2 text-right">
              <div class="inline-flex items-center gap-2">
                <Button variant="outline" size="sm" type="button" onclick={() => onedit(row)}>
                  {m.feedback_staff_editBtn()}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onclick={() => (pendingDeleteId = row.id)}
                >
                  {m.feedback_staff_deleteBtn()}
                </Button>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<ConfirmDialog
  open={pendingDeleteId !== null}
  title={m.feedback_staff_deleteConfirm()}
  message=""
  confirmText={m.feedback_staff_deleteBtn()}
  cancelText={m.rejudge_dialog_cancelBtn()}
  variant="danger"
  onconfirm={confirmDelete}
  oncancel={() => (pendingDeleteId = null)}
/>
