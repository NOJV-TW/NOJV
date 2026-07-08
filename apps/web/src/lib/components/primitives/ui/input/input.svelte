<script lang="ts">
  import type { HTMLInputAttributes, HTMLInputTypeAttribute } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils/css.js";

  type InputType = Exclude<HTMLInputTypeAttribute, "file">;

  type Props = WithElementRef<
    Omit<HTMLInputAttributes, "type"> &
      ({ type: "file"; files?: FileList } | { type?: InputType; files?: undefined })
  >;

  let {
    ref = $bindable(null),
    value = $bindable(),
    type,
    files = $bindable(),
    class: className,
    "data-slot": dataSlot = "input",
    ...restProps
  }: Props = $props();
</script>

{#if type === "file"}
  <input
    bind:this={ref}
    data-slot={dataSlot}
    class={cn(
      "border-input bg-background selection:bg-primary dark:bg-input/30 selection:text-primary-foreground placeholder:text-muted-foreground flex h-10 w-full min-w-0 rounded-md border px-3 pt-2 text-sm font-medium shadow-rest outline-none transition-[border-color,box-shadow] duration-fast ease-out-soft",
      "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
      "focus-ring focus-visible:border-ring",
      "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
      className,
    )}
    type="file"
    bind:files
    bind:value
    {...restProps}
  />
{:else}
  <input
    bind:this={ref}
    data-slot={dataSlot}
    class={cn(
      "border-input bg-background selection:bg-primary dark:bg-input/30 selection:text-primary-foreground placeholder:text-muted-foreground flex h-10 w-full min-w-0 rounded-md border px-3 py-2 text-sm shadow-rest outline-none transition-[border-color,box-shadow] duration-fast ease-out-soft [&[type=number]]:tabular-nums",
      "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
      "focus-ring focus-visible:border-ring",
      "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
      className,
    )}
    {type}
    bind:value
    {...restProps}
  />
{/if}
