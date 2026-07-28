"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_SHEET_ROWS, SHEET_ACCEPT } from "@/lib/sheet";

export function UploadCard() {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || loading) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/verify/upload", { method: "POST", body: fd });
      const data: { runId?: string; total?: number; error?: string } = await res.json();

      if (!res.ok || !data.runId) {
        toast.error(data.error ?? "Could not read that file");
        setLoading(false);
        return;
      }
      toast.success(`Checking ${data.total} address${data.total === 1 ? "" : "es"}`);
      // Navigation unmounts this component, so `loading` stays true on purpose.
      router.push(`/verify/${data.runId}`);
    } catch {
      toast.error("Could not upload that file");
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check a sheet</CardTitle>
        <CardDescription>
          Upload a sheet with an email column. Every address is checked against
          its mail server, and you get your sheet back with the bad rows removed
          — all your other columns untouched.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="verify-file">Contacts file</Label>
            <Input
              id="verify-file"
              ref={inputRef}
              type="file"
              accept={SHEET_ACCEPT}
              disabled={loading}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              .csv or .xlsx, up to {MAX_SHEET_ROWS} rows and 5MB. One column must
              hold the email addresses — name it{" "}
              <code className="font-mono">Email</code> and it will be found
              automatically.
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={!file || loading}>
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload data-icon="inline-start" />
              )}
              {loading ? "Starting..." : "Check addresses"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
