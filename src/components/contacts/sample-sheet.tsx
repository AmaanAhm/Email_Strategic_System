import { Download, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
    <Alert
      className={cn("border-amber-500/40 bg-amber-500/10 text-left", className)}
    >
      <TriangleAlert className="text-amber-600 dark:text-amber-400" />
      <AlertTitle className="text-amber-900 dark:text-amber-200">
        Sample data only — do not send emails to these addresses
      </AlertTitle>
      <AlertDescription className="text-amber-900/80 dark:text-amber-200/80">
        The names and email addresses in the sample sheet are placeholders on
        the reserved <code className="font-mono">example.com</code> domain. They
        exist to show the required column format. Replace every row with your
        own contacts before importing.
      </AlertDescription>
    </Alert>
  );
}
