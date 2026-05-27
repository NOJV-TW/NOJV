<script lang="ts">
  import { Badge, type BadgeSize } from "$lib/components/primitives/ui/badge";
  import { formatVerdictLabel, verdictBadgeVariant } from "$lib/utils/verdict-style";

  let { verdict, size = "sm" }: { verdict: string; size?: BadgeSize } = $props();
</script>

<Badge variant={verdictBadgeVariant(verdict)} {size}>{formatVerdictLabel(verdict)}</Badge>
