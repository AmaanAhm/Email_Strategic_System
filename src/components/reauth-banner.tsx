import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function ReauthBanner() {
  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>Google connection expired</AlertTitle>
      <AlertDescription>
        Emails are paused. Reconnect to resume sending.
      </AlertDescription>
      <AlertAction>
        <Button asChild size="sm" variant="destructive">
          <Link href="/login">Reconnect Google</Link>
        </Button>
      </AlertAction>
    </Alert>
  );
}
