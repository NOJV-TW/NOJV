<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const badgeVariants = tv({
		base: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border font-medium whitespace-nowrap tabular-nums transition-[color,box-shadow] duration-fast ease-out-soft focus-visible:ring-[3px] [&>svg]:pointer-events-none [&>svg]:size-3",
		variants: {
			variant: {
				default:
					"bg-primary text-primary-foreground [a&]:hover:bg-primary/90 border-transparent",
				secondary:
					"bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90 border-transparent",
				destructive:
					"bg-destructive [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/70 border-transparent text-white",
				outline: "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
				success: "bg-success/15 text-success border-success/20",
				warning: "bg-warning/15 text-warning border-warning/20",
				info: "bg-info/15 text-info border-info/20",
				muted: "bg-muted text-muted-foreground border-border",
				"verdict-ac": "bg-success/15 text-success border-success/25",
				"verdict-wa": "bg-destructive/15 text-destructive border-destructive/25",
				"verdict-tle": "bg-warning/15 text-warning border-warning/25",
				"verdict-mle": "bg-warning/15 text-warning border-warning/25",
				"verdict-re": "bg-destructive/15 text-destructive border-destructive/25",
				"verdict-ce": "bg-destructive/15 text-destructive border-destructive/25",
				"verdict-pending": "bg-info/15 text-info border-info/25 animate-pulse",
				"verdict-partial": "bg-warning/15 text-warning border-warning/25",
			},
			size: {
				xs: "px-1.5 py-0 text-[10px] h-4",
				sm: "px-2 py-0.5 text-xs h-5",
				md: "px-2.5 py-1 text-[length:var(--text-caption)] h-6",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "sm",
		},
	});

	export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
	export type BadgeSize = VariantProps<typeof badgeVariants>["size"];
</script>

<script lang="ts">
	import type { HTMLAnchorAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		href,
		class: className,
		variant = "default",
		size = "sm",
		dot = false,
		children,
		...restProps
	}: WithElementRef<HTMLAnchorAttributes> & {
		variant?: BadgeVariant;
		size?: BadgeSize;
		dot?: boolean;
	} = $props();
</script>

<svelte:element
	this={href ? "a" : "span"}
	bind:this={ref}
	data-slot="badge"
	{href}
	class={cn(badgeVariants({ variant, size }), className)}
	{...restProps}
>
	{#if dot}
		<span class="h-1.5 w-1.5 rounded-full bg-current mr-1.5 shrink-0" aria-hidden="true"></span>
	{/if}
	{@render children?.()}
</svelte:element>
