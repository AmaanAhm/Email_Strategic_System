import type { VerifyVerdict } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const styles: Record<VerifyVerdict, { label: string; className: string }> = {
  PENDING: { label: "Checking", className: "bg-muted text-muted-foreground" },
  DELIVERABLE: {
    label: "Deliverable",
    className: "bg-green-500/15 text-green-600 dark:text-green-400",
  },
  RISKY: {
    label: "Risky",
    className: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  UNDELIVERABLE: {
    label: "Undeliverable",
    className: "bg-red-500/15 text-red-600 dark:text-red-400",
  },
};

export function VerdictBadge({ verdict }: { verdict: VerifyVerdict }) {
  const style = styles[verdict];
  return (
    <Badge variant="secondary" className={cn(style.className)}>
      {style.label}
    </Badge>
  );
}
