<script lang="ts">
  import { goto } from "$app/navigation";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";

  interface Props {
    /** Problem ID; required for routing to the advanced edit page. */
    problemId: string;
    /**
     * Optional async hook (e.g. PATCH the problem to mode="advanced") run
     * after the user confirms but before navigation.
     */
    onswitch?: () => Promise<void> | void;
  }

  let { problemId, onswitch }: Props = $props();
  let showConfirm = $state(false);
  let switching = $state(false);

  async function confirm() {
    switching = true;
    try {
      await onswitch?.();
    } finally {
      switching = false;
      showConfirm = false;
      await goto(`/problems/${problemId}/edit-advanced`);
    }
  }
</script>

<button
  type="button"
  class="text-sm font-medium text-primary underline-offset-4 transition hover:underline"
  onclick={() => (showConfirm = true)}
>
  🔧 嘗試更複雜的題目設計 →
</button>

<ConfirmDialog
  bind:open={showConfirm}
  variant="danger"
  title="切換到進階模式？"
  message="切換後，原本的標準模式測資與評分設定將會失效，需要改用 TA 提供的判分容器。確定要繼續嗎？"
  confirmText={switching ? "切換中…" : "切換"}
  oncancel={() => (showConfirm = false)}
  onconfirm={confirm}
/>
