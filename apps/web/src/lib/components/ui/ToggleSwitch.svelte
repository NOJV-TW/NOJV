<script lang="ts">
  interface Props {
    checked: boolean;
    onchange?: (checked: boolean) => void;
  }

  let { checked = $bindable(), onchange }: Props = $props();
</script>

<button
  class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors
    {checked ? 'bg-primary' : 'bg-muted'}"
  onclick={() => { checked = !checked; onchange?.(checked); }}
  role="switch"
  aria-checked={checked}
  type="button"
>
  <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform
    {checked ? 'translate-x-6' : 'translate-x-1'}"></span>
</button>
