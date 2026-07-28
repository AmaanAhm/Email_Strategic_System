"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { toast } from "sonner";
import {
  Check,
  FileText,
  Loader2,
  Paperclip,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  createCampaign,
  deleteCampaignDraft,
  saveCampaignDraft,
} from "@/app/(app)/campaigns/actions";
import type { CampaignDraftData } from "@/lib/campaign-draft";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { findTemplateIssues, TEMPLATE_VARIABLES } from "@/lib/template";
import {
  ACCEPT_ATTRIBUTE,
  MAX_ATTACHMENT_BYTES,
  allowedTypesSummary,
  isAllowedFileName,
} from "@/lib/attachments";

// Offer exactly what validation accepts — a shorter chip list reads as "these
// are the only ones that work" and pushes people to invent their own.
const BODY_VARIABLES = TEMPLATE_VARIABLES;
const SUBJECT_VARIABLES = TEMPLATE_VARIABLES;

/**
 * Quiet period after the last keystroke before a draft is written. Long enough
 * that ordinary typing is one save, short enough that clicking away in a hurry
 * has usually already been captured.
 */
const DRAFT_SAVE_DELAY_MS = 900;

interface ContactOption {
  id: string;
  name: string;
  company: string;
  email: string;
  groupId: string;
}

interface GroupOption {
  id: string;
  name: string;
  count: number;
}

interface SenderOption {
  id: string;
  email: string;
  name: string | null;
  isDefault: boolean;
}

interface UploadedPdf {
  path: string;
  fileName: string;
  size: number;
}

interface CampaignFormProps {
  contacts: ContactOption[];
  groups: GroupOption[];
  senders: SenderOption[];
  defaultTimezone: string;
  /** Set when resuming a saved draft; subsequent saves update this row. */
  draftId?: string | null;
  /** Loaded server-side, so resuming never causes a hydration mismatch. */
  initialDraft?: CampaignDraftData | null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/**
 * Convert a manually-picked date + hour + minute — read as wall-clock time in
 * the campaign's own timezone — into a UTC ISO instant. This is what removes
 * the browser-vs-campaign-timezone mismatch.
 */
function zonedFieldsToUtcIso(
  date: string,
  hour: string,
  minute: string,
  timezone: string,
): string | null {
  if (!date || hour === "" || minute === "") return null;
  const wall = `${date}T${pad(Number(hour))}:${pad(Number(minute))}:00`;
  const utc = fromZonedTime(wall, timezone);
  return Number.isNaN(utc.getTime()) ? null : utc.toISOString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TemplateIssues({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="text-xs text-destructive">
        {issues.map((issue) => (
          <p key={issue}>{issue}</p>
        ))}
        <p className="mt-1 opacity-80">
          Recipients would receive these characters literally. Use only{" "}
          <span className="font-mono">
            {TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(", ")}
          </span>
          .
        </p>
      </div>
    </div>
  );
}

export function CampaignForm({
  contacts,
  groups,
  senders,
  defaultTimezone,
  draftId = null,
  initialDraft = null,
}: CampaignFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  // Tracks which row to update. Starts as the resumed draft, and is set after
  // the first save so later saves update instead of piling up new rows.
  const [currentDraftId, setCurrentDraftId] = React.useState(draftId);
  const resumingSavedDraft = draftId !== null;

  // Basics
  const [name, setName] = React.useState(initialDraft?.name ?? "");
  const [senderId, setSenderId] = React.useState(() => {
    const saved = initialDraft?.senderId;
    if (saved && senders.some((s) => s.id === saved)) return saved;
    return senders.find((s) => s.isDefault)?.id ?? senders[0]?.id ?? "";
  });

  // Email
  const [masterSubject, setMasterSubject] = React.useState(
    initialDraft?.masterSubject ?? "",
  );
  const [masterBody, setMasterBody] = React.useState(
    initialDraft?.masterBody ?? "",
  );
  const subjectRef = React.useRef<HTMLInputElement>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  // Attachment
  const [pdf, setPdf] = React.useState<UploadedPdf | null>(
    initialDraft?.pdf ?? null,
  );
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Recipients
  const [recipientMode, setRecipientMode] = React.useState<"all" | "group">(
    initialDraft?.recipientMode ?? "all",
  );
  const [selectedGroupId, setSelectedGroupId] = React.useState(() => {
    const saved = initialDraft?.selectedGroupId;
    // A group deleted since the draft was saved must not leave the Select stuck.
    return saved && groups.some((g) => g.id === saved) ? saved : "";
  });

  // Schedule
  const [startMode, setStartMode] = React.useState<"immediate" | "scheduled">(
    initialDraft?.startMode ?? "immediate",
  );
  const [startDate, setStartDate] = React.useState(
    initialDraft?.startDate ?? "",
  );
  const [startHour, setStartHour] = React.useState(
    initialDraft?.startHour ?? "",
  );
  const [startMinute, setStartMinute] = React.useState(
    initialDraft?.startMinute ?? "",
  );
  const [timezone, setTimezone] = React.useState(
    initialDraft?.timezone || defaultTimezone,
  );

  // Switching to a scheduled start pre-fills the manual fields with "about now"
  // in the campaign timezone. Computed here (a user event, post-mount) rather
  // than in an effect, so there's no SSR/client hydration mismatch.
  function chooseScheduled() {
    setStartMode("scheduled");
    if (!startDate) {
      const z = toZonedTime(new Date(), timezone);
      setStartDate(
        `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}`,
      );
      setStartHour(String(z.getHours()));
      setStartMinute(String(z.getMinutes()));
    }
  }

  const [workStartHour, setWorkStartHour] = React.useState(
    initialDraft?.workStartHour ?? "9",
  );
  const [workEndHour, setWorkEndHour] = React.useState(
    initialDraft?.workEndHour ?? "18",
  );
  const [minDelaySeconds, setMinDelaySeconds] = React.useState(
    initialDraft?.minDelaySeconds ?? "120",
  );
  const [maxDelaySeconds, setMaxDelaySeconds] = React.useState(
    initialDraft?.maxDelaySeconds ?? "480",
  );
  const [dailyLimit, setDailyLimit] = React.useState(
    initialDraft?.dailyLimit ?? "100",
  );

  // ---- Automatic draft saving -------------------------------------------
  //
  // No save button by design: work is persisted on its own, the way a mail
  // client keeps an unsent compose. Storage is the server (not localStorage)
  // so the draft is one thing, visible in the Drafts list from any device.

  const draftState = {
    name,
    senderId,
    masterSubject,
    masterBody,
    pdf,
    recipientMode,
    selectedGroupId,
    startMode,
    startDate,
    startHour,
    startMinute,
    timezone,
    workStartHour,
    workEndHour,
    minDelaySeconds,
    maxDelaySeconds,
    dailyLimit,
  };
  const draftJson = JSON.stringify(draftState);

  // Only what a person actually typed makes a draft. Schedule defaults alone
  // would turn every visit to this page into a row in the Drafts list.
  const hasAnyContent =
    name.trim() !== "" ||
    masterSubject.trim() !== "" ||
    masterBody.trim() !== "" ||
    pdf !== null;

  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved">(
    resumingSavedDraft ? "saved" : "idle",
  );
  // Refs, not state: these are read inside timers and the unmount cleanup,
  // where a stale closure would save the wrong snapshot or duplicate a row.
  const draftIdRef = React.useRef(draftId);
  const savedJsonRef = React.useRef<string | null>(
    resumingSavedDraft ? draftJson : null,
  );
  const latestRef = React.useRef({ json: draftJson, hasAnyContent });
  const submittedRef = React.useRef(false);
  /**
   * Tail of the save queue. Saves must not overlap: the row id only exists
   * once the first one returns, so two in flight together would each create a
   * draft and the user would find duplicates in the list.
   */
  const queueRef = React.useRef<Promise<unknown>>(Promise.resolve());

  React.useEffect(() => {
    latestRef.current = { json: draftJson, hasAnyContent };
  }, [draftJson, hasAnyContent]);

  /** Chain onto the queue so writes for one form are strictly ordered. */
  const enqueue = React.useCallback(
    <T,>(work: () => Promise<T>): Promise<T> => {
      const next = queueRef.current.then(work, work);
      // Swallow here only for the queue's own chain; callers still see errors.
      queueRef.current = next.catch(() => undefined);
      return next;
    },
    [],
  );

  const persistDraft = React.useCallback(
    async (snapshot: string) => {
      setSaveState("saving");
      try {
        await enqueue(async () => {
          // Read inside the queued work, not before it: an earlier save may
          // have assigned the id while this one was waiting its turn.
          const wasNew = draftIdRef.current === null;
          if (snapshot === savedJsonRef.current) return;
          const result = await saveCampaignDraft(
            draftIdRef.current,
            JSON.parse(snapshot) as CampaignDraftData,
          );
          if ("error" in result) {
            setSaveState("idle");
            return;
          }
          draftIdRef.current = result.id;
          savedJsonRef.current = snapshot;
          setCurrentDraftId(result.id);
          setSaveState("saved");
          // Only on creation: refreshing on every keystroke-triggered save
          // would refetch the page tree for a count that has not changed.
          if (wasNew) router.refresh();
        });
      } catch {
        // Offline or a server hiccup. Leave savedJsonRef alone so the next
        // change retries rather than assuming this snapshot is stored.
        setSaveState("idle");
      }
    },
    [enqueue, router],
  );

  React.useEffect(() => {
    if (submittedRef.current) return;

    // Emptying the form discards the draft, as deleting a compose does.
    if (!hasAnyContent) {
      if (draftIdRef.current === null) return;
      const id = draftIdRef.current;
      const timer = setTimeout(() => {
        draftIdRef.current = null;
        savedJsonRef.current = null;
        setCurrentDraftId(null);
        setSaveState("idle");
        // Queued as well, so a delete cannot overtake a save still in flight
        // and leave the row it was about to write behind.
        void enqueue(() => deleteCampaignDraft(id)).then(() => router.refresh());
      }, DRAFT_SAVE_DELAY_MS);
      return () => clearTimeout(timer);
    }

    if (draftJson === savedJsonRef.current) return;
    const timer = setTimeout(() => void persistDraft(draftJson), DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draftJson, hasAnyContent, persistDraft, enqueue, router]);

  // Leaving the page mid-edit is the exact case this feature exists for, and
  // it is also when the debounce timer gets cancelled. Flush on the way out.
  React.useEffect(() => {
    return () => {
      const { json, hasAnyContent: had } = latestRef.current;
      if (submittedRef.current || !had || json === savedJsonRef.current) return;
      // Through the queue: the debounced save that was already running must
      // finish and set the id first, or this flush creates a second draft.
      void enqueue(async () => {
        if (json === savedJsonRef.current) return;
        await saveCampaignDraft(
          draftIdRef.current,
          JSON.parse(json) as CampaignDraftData,
        );
      });
    };
  }, [enqueue]);


  // A bad placeholder is caught while typing — once an email is sent with
  // literal "{{...}}" in it there is no way to take it back.
  const subjectIssues = React.useMemo(
    () => findTemplateIssues(masterSubject),
    [masterSubject],
  );
  const bodyIssues = React.useMemo(
    () => findTemplateIssues(masterBody),
    [masterBody],
  );

  const timezones = React.useMemo<string[]>(() => {
    try {
      const list = Intl.supportedValuesOf("timeZone");
      return list.includes(defaultTimezone)
        ? list
        : [defaultTimezone, ...list];
    } catch {
      return [defaultTimezone, "UTC"];
    }
  }, [defaultTimezone]);

  function insertVariable(
    el: HTMLInputElement | HTMLTextAreaElement | null,
    current: string,
    setValue: (v: string) => void,
    variable: string,
  ) {
    const token = `{{${variable}}}`;
    if (!el) {
      setValue(current + token);
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    setValue(current.slice(0, start) + token + current.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isAllowedFileName(file.name)) {
      toast.error(`Unsupported file type. Allowed: ${allowedTypesSummary()}`);
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error("File is too large (max 10MB)");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads/attachment", {
        method: "POST",
        body: fd,
      });
      const json: { path?: string; fileName?: string; error?: string } =
        await res.json();
      if (!res.ok || !json.path || !json.fileName) {
        toast.error(json.error ?? "Upload failed");
        return;
      }
      setPdf({ path: json.path, fileName: json.fileName, size: file.size });
      toast.success("File attached");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // Contact ids belonging to the currently chosen group.
  const groupContactIds = React.useMemo(
    () =>
      selectedGroupId
        ? contacts.filter((c) => c.groupId === selectedGroupId).map((c) => c.id)
        : [],
    [contacts, selectedGroupId],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isPending) return;

    if (!name.trim()) return void toast.error("Campaign name is required");
    if (!masterSubject.trim()) return void toast.error("Subject is required");
    if (!masterBody.trim()) return void toast.error("Email body is required");
    if (subjectIssues.length > 0) {
      return void toast.error(`Subject: ${subjectIssues.join("; ")}`);
    }
    if (bodyIssues.length > 0) {
      return void toast.error(`Email body: ${bodyIssues.join("; ")}`);
    }
    const startIso =
      startMode === "immediate"
        ? new Date().toISOString()
        : zonedFieldsToUtcIso(startDate, startHour, startMinute, timezone);
    if (!startIso) {
      return void toast.error("Pick a valid start date and time");
    }
    const whStartHour = parseInt(workStartHour, 10);
    const whEndHour = parseInt(workEndHour, 10);
    if (whStartHour >= whEndHour) {
      return void toast.error("Work start hour must be before work end hour");
    }
    const minDelay = parseInt(minDelaySeconds, 10);
    const maxDelay = parseInt(maxDelaySeconds, 10);
    if (Number.isNaN(minDelay) || Number.isNaN(maxDelay) || minDelay < 10) {
      return void toast.error("Delays must be at least 10 seconds");
    }
    if (minDelay > maxDelay) {
      return void toast.error("Min delay cannot exceed max delay");
    }
    const limit = parseInt(dailyLimit, 10);
    if (Number.isNaN(limit) || limit < 1 || limit > 150) {
      return void toast.error("Daily limit must be between 1 and 150");
    }
    if (recipientMode === "group") {
      if (!selectedGroupId) {
        return void toast.error("Pick a group to send to");
      }
      if (groupContactIds.length === 0) {
        return void toast.error("That group has no contacts");
      }
    }

    const fd = new FormData();
    fd.append("name", name.trim());
    if (senderId) fd.append("senderIdentityId", senderId);
    fd.append("masterSubject", masterSubject.trim());
    fd.append("masterBody", masterBody);
    fd.append("timezone", timezone);
    fd.append("startAt", startIso);
    fd.append("workStartHour", workStartHour);
    fd.append("workEndHour", workEndHour);
    fd.append("minDelaySeconds", String(minDelay));
    fd.append("maxDelaySeconds", String(maxDelay));
    fd.append("dailyLimit", String(limit));
    if (pdf) {
      fd.append("pdfPath", pdf.path);
      fd.append("pdfFileName", pdf.fileName);
    }
    fd.append(
      "contactIds",
      recipientMode === "all" ? "all" : JSON.stringify(groupContactIds),
    );

    startTransition(async () => {
      const result = await createCampaign(fd);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        // Set before the await so the unmount flush cannot race the redirect
        // and resurrect a draft for a campaign that now exists.
        submittedRef.current = true;
        if (draftIdRef.current) await deleteCampaignDraft(draftIdRef.current);
        toast.success("Campaign created");
        router.push(`/campaigns/${result.id}`);
      }
    });
  }

  const startHours = Array.from({ length: 24 }, (_, i) => i);
  const endHours = Array.from({ length: 24 }, (_, i) => i + 1);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* 1. Basics */}
      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
          <CardDescription>
            Name your campaign and choose which account it sends from.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="grid min-w-0 gap-2">
            <Label htmlFor="campaign-name">Campaign name</Label>
            <Input
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. July agency outreach"
              maxLength={200}
            />
          </div>
          <div className="grid min-w-0 gap-2">
            <Label>Send from</Label>
            {senders.length > 0 ? (
              <Select value={senderId} onValueChange={setSenderId}>
                <SelectTrigger className="w-full min-w-0 *:data-[slot=select-value]:truncate">
                  <SelectValue placeholder="Select a sender" />
                </SelectTrigger>
                <SelectContent>
                  {senders.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="truncate">
                        {s.name ? `${s.name} (${s.email})` : s.email}
                        {s.isDefault ? " — default" : ""}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                No senders connected.{" "}
                <a
                  href="/senders"
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  Connect a Google account
                </a>{" "}
                to send.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 2. Email */}
      <Card>
        <CardHeader>
          <CardTitle>Email</CardTitle>
          <CardDescription>
            Write the master email. AI will uniquely rewrite it for every
            recipient so no two emails are identical, while keeping your
            message and offer intact.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-2">
            <Label htmlFor="master-subject">Subject</Label>
            <Input
              id="master-subject"
              ref={subjectRef}
              value={masterSubject}
              onChange={(e) => setMasterSubject(e.target.value)}
              placeholder="Quick idea for {{company}}"
              maxLength={500}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Insert:</span>
              {SUBJECT_VARIABLES.map((v) => (
                <Button
                  key={`subject-${v}`}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 font-mono text-xs"
                  onClick={() =>
                    insertVariable(
                      subjectRef.current,
                      masterSubject,
                      setMasterSubject,
                      v,
                    )
                  }
                >
                  {`{{${v}}}`}
                </Button>
              ))}
            </div>
            <TemplateIssues issues={subjectIssues} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="master-body">Body</Label>
            <Textarea
              id="master-body"
              ref={bodyRef}
              value={masterBody}
              onChange={(e) => setMasterBody(e.target.value)}
              rows={10}
              className="min-h-56 font-mono text-sm"
              placeholder={`Hi {{name}},\n\nI noticed {{company}} is doing great work in {{industry}}...`}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Insert:</span>
              {BODY_VARIABLES.map((v) => (
                <Button
                  key={`body-${v}`}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 font-mono text-xs"
                  onClick={() =>
                    insertVariable(bodyRef.current, masterBody, setMasterBody, v)
                  }
                >
                  {`{{${v}}}`}
                </Button>
              ))}
            </div>
            <TemplateIssues issues={bodyIssues} />
            <p className="text-xs text-muted-foreground">
              Variables are filled per recipient, then AI rewrites each email
              with a unique greeting, opening, body, and call to action.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 3. Attachment */}
      <Card>
        <CardHeader>
          <CardTitle>Attachment</CardTitle>
          <CardDescription>
            Optionally attach one file (max 10MB). It is sent with every email.
            Supported: {allowedTypesSummary()}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            className="hidden"
            onChange={handleFileChange}
          />
          {pdf ? (
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm">{pdf.fileName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatBytes(pdf.size)}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPdf(null)}
                aria-label="Remove attachment"
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Paperclip className="size-4" />
              )}
              {uploading ? "Uploading..." : "Attach file"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* 4. Recipients */}
      <Card>
        <CardHeader>
          <CardTitle>Recipients</CardTitle>
          <CardDescription>Choose who receives this campaign.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="recipientMode"
              className="accent-primary"
              checked={recipientMode === "all"}
              onChange={() => setRecipientMode("all")}
            />
            All contacts ({contacts.length})
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="recipientMode"
              className="accent-primary"
              checked={recipientMode === "group"}
              onChange={() => setRecipientMode("group")}
              disabled={groups.length === 0}
            />
            Select group
            {groups.length === 0 && (
              <span className="text-xs text-muted-foreground">
                (no groups yet)
              </span>
            )}
          </label>

          {recipientMode === "group" && (
            <div className="flex flex-col gap-2">
              <Select
                value={selectedGroupId}
                onValueChange={setSelectedGroupId}
              >
                <SelectTrigger className="w-full min-w-0 sm:max-w-sm *:data-[slot=select-value]:truncate">
                  <SelectValue placeholder="Choose a group" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem
                      key={g.id}
                      value={g.id}
                      disabled={g.count === 0}
                    >
                      <span className="truncate">
                        {g.name} ({g.count} contact{g.count === 1 ? "" : "s"})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedGroupId && (
                <span className="text-xs text-muted-foreground">
                  {groupContactIds.length} recipient
                  {groupContactIds.length === 1 ? "" : "s"} from this group
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. Schedule */}
      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>
            Emails are sent at random human-like intervals within working
            hours in the selected timezone.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-3 sm:col-span-2">
            <Label>Start sending</Label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="startMode"
                  className="accent-primary"
                  checked={startMode === "immediate"}
                  onChange={() => setStartMode("immediate")}
                />
                As soon as I launch
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="startMode"
                  className="accent-primary"
                  checked={startMode === "scheduled"}
                  onChange={chooseScheduled}
                />
                At a specific date &amp; time
              </label>
            </div>

            {startMode === "scheduled" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label
                    htmlFor="start-date"
                    className="text-xs text-muted-foreground"
                  >
                    Date
                  </Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    suppressHydrationWarning
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-xs text-muted-foreground">Hour</Label>
                  <Select value={startHour} onValueChange={setStartHour}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="HH" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {HOURS_24.map((h) => (
                        <SelectItem key={h} value={String(h)}>
                          {pad(h)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-xs text-muted-foreground">
                    Minute
                  </Label>
                  <Select value={startMinute} onValueChange={setStartMinute}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="MM" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {MINUTES.map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {pad(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {startMode === "immediate"
                ? "Sending begins when you launch the campaign, within your working hours below."
                : `Interpreted in ${timezone}. Sending still respects your working hours below.`}
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {timezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Work start hour</Label>
            <Select value={workStartHour} onValueChange={setWorkStartHour}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {startHours.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {pad(h)}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Work end hour</Label>
            <Select value={workEndHour} onValueChange={setWorkEndHour}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {endHours.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {pad(h)}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="min-delay">Min delay (seconds)</Label>
            <Input
              id="min-delay"
              type="number"
              min={10}
              max={3600}
              value={minDelaySeconds}
              onChange={(e) => setMinDelaySeconds(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="max-delay">Max delay (seconds)</Label>
            <Input
              id="max-delay"
              type="number"
              min={10}
              max={3600}
              value={maxDelaySeconds}
              onChange={(e) => setMaxDelaySeconds(e.target.value)}
            />
          </div>

          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="daily-limit">Daily limit</Label>
            <Input
              id="daily-limit"
              type="number"
              min={1}
              max={150}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              className="sm:max-w-40"
            />
            <p className="text-xs text-muted-foreground">
              Gmail-safe: 100–150/day
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {saveState === "saving" ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Saving to Drafts...
          </p>
        ) : saveState === "saved" && currentDraftId ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            Saved to Drafts. You can leave this page and come back.
          </p>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={isPending || uploading}>
          {isPending && <Loader2 className="size-4 animate-spin" />}
          {isPending ? "Creating..." : "Create campaign"}
        </Button>
      </div>
    </form>
  );
}
