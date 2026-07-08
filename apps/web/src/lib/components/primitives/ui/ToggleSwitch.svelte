<script lang="ts">
  let { checked = $bindable(false) }: { checked?: boolean } = $props();
</script>

<label class="flex cursor-pointer items-center">
  <input type="checkbox" class="peer sr-only" bind:checked />
  <span
    class="relative block h-5 w-10 flex-shrink-0 rounded-full border border-border bg-muted transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background"
    aria-hidden="true"
  >
    <span
      class="absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-[18px]"
    ></span>
  </span>
</label>
