import { Download, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const SAMPLE_SHEET_PATH = "/sample-contacts.csv";

export function SampleSheetButton({
  className,
  variant = "outline",
}: {
  className?: string;
  variant?: "outline" | "ghost" | "secondary";
}) {
  return (
    <Button asChild variant={variant} className={className}>
      <a href={SAMPLE_SHEET_PATH} download="sample-contacts.csv">
        <Download data-icon="inline-start" />
        Download sample sheet
      </a>
    </Button>
  );
}

export function SampleSheetNote({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-left text-xs text-amber-700 dark:text-amber-400/90",
        className,
      )}
    >
      <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>
        Sample rows are placeholders on{" "}
        <code className="font-mono">example.com</code> — replace them with your
        own contacts.
      </span>
    </p>
  );
}
