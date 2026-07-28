"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Calendar-safe "yyyy-MM-dd" for a given year / 0-indexed month / day. */
function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Month calendar for the dashboard's "sent on a day" view. Days with sends get a
 * green dot; picking a day drives the `day` search param (server recomputes the
 * count + breakdown). Future days are disabled.
 */
export function SentCalendar({
  selected,
  today,
  markedDays,
}: {
  selected: string;
  today: string;
  markedDays: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const marked = React.useMemo(() => new Set(markedDays), [markedDays]);

  const [sy, sm] = selected.split("-").map(Number);
  const [view, setView] = React.useState({ year: sy, month: sm - 1 });

  // Follow the selected day into its month if it changes from outside.
  const [syncKey, setSyncKey] = React.useState(selected);
  if (selected !== syncKey) {
    setSyncKey(selected);
    setView({ year: sy, month: sm - 1 });
  }

  function navigate(day: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("day", day);
    startTransition(() => {
      router.replace(`/dashboard?${params.toString()}`, { scroll: false });
    });
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  const firstDow = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="select-none" data-pending={pending ? "" : undefined}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">
          {MONTHS[view.month]} {view.year}
        </span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Next month"
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="pb-1 text-xs font-medium text-muted-foreground"
          >
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`blank-${i}`} />;
          const key = ymd(view.year, view.month, d);
          const isFuture = key > today;
          const isSelected = key === selected;
          const isToday = key === today;
          const hasSends = marked.has(key);
          return (
            <div key={key} className="flex justify-center">
              <button
                type="button"
                disabled={isFuture}
                onClick={() => navigate(key)}
                aria-label={
                  hasSends ? `${key} — has sends` : key
                }
                aria-current={isSelected ? "date" : undefined}
                className={cn(
                  "group flex flex-col items-center gap-1",
                  isFuture && "cursor-not-allowed",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-sm tabular-nums transition-colors",
                    isFuture && "text-muted-foreground/40",
                    !isFuture &&
                      !isSelected &&
                      "group-hover:bg-accent",
                    isSelected &&
                      "bg-primary font-semibold text-primary-foreground",
                    !isSelected && isToday && "ring-1 ring-primary/50",
                  )}
                >
                  {d}
                </span>
                {/* The slot is always rendered, transparent when the day has no
                    sends, so every week is the same height and the dot never
                    crowds the digit above it. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full",
                    hasSends ? "bg-gmail-green" : "bg-transparent",
                  )}
                />
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-gmail-green" />
        Days with sends
      </div>
    </div>
  );
}
