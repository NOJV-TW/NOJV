<script lang="ts" module>
  import { cn, type WithElementRef } from "$lib/utils/css.js";
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
  import { type VariantProps, tv } from "tailwind-variants";

  export const buttonVariants = tv({
    base: "focus-ring focus-visible:border-ring aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap tabular-nums outline-none transition-[transform,box-shadow,background-color,color] duration-fast ease-out-soft motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-rest aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-rest hover:shadow-hover",
        destructive:
          "bg-destructive hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60 text-white shadow-rest hover:shadow-hover",
        outline:
          "bg-background hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 border shadow-rest hover:shadow-hover",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-rest hover:shadow-hover",
        ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline motion-safe:hover:translate-y-0",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        sm: "h-9 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-11 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-10",
        "icon-sm": "size-9",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  });

  export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
  export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

  export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      variant?: ButtonVariant;
      size?: ButtonSize;
      loading?: boolean;
    };
</script>

<script lang="ts">
  import { Loader2 } from "@lucide/svelte";

  let {
    class: className,
    variant = "default",
    size = "default",
    ref = $bindable(null),
    href = undefined,
    type = "button",
    disabled,
    loading = false,
    children,
    ...restProps
  }: ButtonProps = $props();

  const isDisabled = $derived(disabled || loading);
</script>

{#snippet content()}
  {#if loading}
    <span class="inline-flex items-center gap-2 opacity-0" aria-hidden="true">
      {@render children?.()}
    </span>
    <span class="absolute inset-0 flex items-center justify-center">
      <Loader2 class="size-4 animate-spin" aria-hidden="true" />
    </span>
  {:else}
    {@render children?.()}
  {/if}
{/snippet}

{#if href}
  <a
    bind:this={ref}
    data-slot="button"
    class={cn(buttonVariants({ variant, size }), className)}
    href={isDisabled ? undefined : href}
    aria-disabled={isDisabled}
    aria-busy={loading ? "true" : undefined}
    role={isDisabled ? "link" : undefined}
    tabindex={isDisabled ? -1 : undefined}
    {...restProps}
  >
    {@render content()}
  </a>
{:else}
  <button
    bind:this={ref}
    data-slot="button"
    class={cn(buttonVariants({ variant, size }), className)}
    {type}
    disabled={isDisabled}
    aria-busy={loading ? "true" : undefined}
    {...restProps}
  >
    {@render content()}
  </button>
{/if}
