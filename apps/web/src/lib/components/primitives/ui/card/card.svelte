<script lang="ts" module>
  import { cn, type WithElementRef } from "$lib/utils/css.js";
  import type { HTMLAttributes } from "svelte/elements";
  import { type VariantProps, tv } from "tailwind-variants";

  export const cardVariants = tv({
    base: "text-card-foreground flex flex-col backdrop-blur-sm border transition-[transform,box-shadow] duration-normal ease-out-soft",
    variants: {
      variant: {
        surface: "bg-[color:var(--color-panel)] border-border-subtle shadow-rest",
        strong: "bg-[color:var(--color-panel-strong)] border-border-subtle shadow-rest",
        flat: "bg-[color:var(--color-panel)] border-border-subtle",
        elevated: "bg-[color:var(--color-panel-strong)] border-border-subtle shadow-hover",
        outline: "bg-transparent border-border-strong",
      },
      size: {
        sm: "rounded-md p-3 gap-3",
        md: "rounded-lg p-4 gap-4",
        lg: "rounded-xl p-4 gap-5",
        hero: "rounded-2xl p-6 gap-6",
      },
      interactive: {
        true: "cursor-pointer hover:-translate-y-px hover:shadow-hover motion-safe:will-change-transform",
      },
    },
    defaultVariants: {
      variant: "surface",
      size: "md",
    },
  });

  export type CardVariant = VariantProps<typeof cardVariants>["variant"];
  export type CardSize = VariantProps<typeof cardVariants>["size"];
  export type CardInteractive = VariantProps<typeof cardVariants>["interactive"];

  export type CardProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    variant?: CardVariant;
    size?: CardSize;
    interactive?: CardInteractive;
  };
</script>

<script lang="ts">
  let {
    ref = $bindable(null),
    class: className,
    variant = "surface",
    size = "md",
    interactive,
    children,
    ...restProps
  }: CardProps = $props();
</script>

<div
  bind:this={ref}
  data-slot="card"
  class={cn(cardVariants({ variant, size, interactive }), className)}
  {...restProps}
>
  {@render children?.()}
</div>
