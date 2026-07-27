"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SampleSheetButton,
  SampleSheetNote,
} from "@/components/contacts/sample-sheet";
import type { ImportResult } from "@/lib/types";

const EXPECTED_COLUMNS: { column: string; required: boolean; aliases: string }[] =
  [
    { column: "Name", required: true, aliases: "Full Name, Contact Name, Contact" },
    { column: "Company", required: true, aliases: "Organization, Company Name" },
    { column: "Email", required: true, aliases: "Email Address, E-mail" },
    { column: "Website", required: false, aliases: "URL, Site, Web" },
    { column: "Industry", required: false, aliases: "Sector, Category" },
  ];

export function ImportDialog({
  groupId,
  triggerLabel = "Import",
}: {
  groupId: string;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function handleOpenChange(nextOpen: boolean) {
    if (loading) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      if (result) router.refresh();
      setFile(null);
      setResult(null);
    }
  }

  async function handleSubmit() {
    if (!file || loading) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("groupId", groupId);
      const res = await fetch("/api/contacts/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          typeof data?.error === "string" ? data.error : "Import failed"
        );
        return;
      }
      const importResult = data as ImportResult;
      setResult(importResult);
      toast.success(
        `Imported ${importResult.imported} contact${importResult.imported === 1 ? "" : "s"}`
      );
    } catch {
      toast.error("Import failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Upload data-icon="inline-start" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import contacts</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel file (.csv, .xlsx, .xls) up to 5MB.
          </DialogDescription>
        </DialogHeader>

        {result === null ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="contacts-file">File</Label>
              <Input
                id="contacts-file"
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                disabled={loading}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Click to browse or drag and drop a file onto the field above.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Not sure about the format?</p>
                <SampleSheetButton variant="secondary" />
              </div>
              <SampleSheetNote />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Expected columns</p>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Column</TableHead>
                      <TableHead>Required</TableHead>
                      <TableHead>Also accepted as</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {EXPECTED_COLUMNS.map((col) => (
                      <TableRow key={col.column}>
                        <TableCell className="font-medium">
                          {col.column}
                        </TableCell>
                        <TableCell>{col.required ? "Yes" : "No"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {col.aliases}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border p-3">
                <p className="text-lg font-semibold">{result.imported}</p>
                <p className="text-xs text-muted-foreground">Imported</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-lg font-semibold">
                  {result.skippedDuplicates}
                </p>
                <p className="text-xs text-muted-foreground">
                  Skipped duplicates
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-lg font-semibold">{result.errors.length}</p>
                <p className="text-xs text-muted-foreground">Errors</p>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Row errors</p>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {result.errors.map((err, i) => (
                    <p
                      key={`${err.row}-${i}`}
                      className="text-xs text-muted-foreground"
                    >
                      <span className="font-medium text-destructive">
                        Row {err.row}:
                      </span>{" "}
                      {err.message}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {result === null ? (
            <>
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button disabled={!file || loading} onClick={handleSubmit}>
                {loading ? (
                  <>
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                    Importing...
                  </>
                ) : (
                  "Import contacts"
                )}
              </Button>
            </>
          ) : (
            <Button onClick={() => handleOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
