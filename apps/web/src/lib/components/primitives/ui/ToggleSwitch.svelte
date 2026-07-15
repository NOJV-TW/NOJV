<script lang="ts">
  interface Props {
    id: string;
    label: string;
    descriptionId?: string;
    checked?: boolean;
    disabled?: boolean;
  }

  let {
    id,
    label,
    descriptionId,
    checked = $bindable(false),
    disabled = false,
  }: Props = $props();
</script>

<label
  for={id}
  class="relative flex cursor-pointer items-center has-disabled:cursor-not-allowed"
>
  <span class="sr-only">{label}</span>
  <input
    {id}
    type="checkbox"
    role="switch"
    class="peer sr-only"
    aria-describedby={descriptionId}
    bind:checked
    {disabled}
  />
  <span
    class="block h-5 w-10 flex-shrink-0 rounded-full border border-border bg-muted transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:opacity-50"
    aria-hidden="true"
  ></span>
  <span
    class="absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-[18px] peer-disabled:opacity-70"
    aria-hidden="true"
  ></span>
</label>
