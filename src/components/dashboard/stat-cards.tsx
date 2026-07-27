import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export type StatTone = "blue" | "green" | "amber" | "red" | "violet";

export interface StatCardItem {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: StatTone;
}

const TONE_TILE: Record<StatTone, string> = {
  blue: "bg-gmail-blue/15 text-gmail-blue",
  green: "bg-gmail-green/15 text-gmail-green",
  amber: "bg-gmail-yellow/25 text-[oklch(0.6_0.13_75)] dark:text-gmail-yellow",
  red: "bg-gmail-red/15 text-gmail-red",
  violet: "bg-chart-5/18 text-chart-5",
};

// Soft tone-matched glow that tints the card corner behind the frosted glass.
const TONE_GLOW: Record<StatTone, string> = {
  blue: "before:bg-gmail-blue/25",
  green: "before:bg-gmail-green/25",
  amber: "before:bg-gmail-yellow/30",
  red: "before:bg-gmail-red/25",
  violet: "before:bg-chart-5/25",
};

const CYCLE: StatTone[] = ["blue", "amber", "violet", "green", "red"];

export function StatCards({ items }: { items: StatCardItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 xl:grid-cols-5">
      {items.map((item, i) => {
        const tone = item.tone ?? CYCLE[i % CYCLE.length];
        return (
          <Card
            key={item.label}
            size="sm"
            className={cn(
              "relative isolate transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl",
              // tone glow bleeding from the top-right corner
              "before:pointer-events-none before:absolute before:-top-8 before:-right-6 before:-z-10 before:size-24 before:rounded-full before:blur-2xl before:content-['']",
              TONE_GLOW[tone],
            )}
          >
            <CardContent className="flex items-center gap-3">
              <div
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-white/20",
                  TONE_TILE[tone],
                )}
              >
                <item.icon className="size-[1.15rem]" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-muted-foreground">
                  {item.label}
                </p>
                <p className="text-3xl font-semibold tracking-tight tabular-nums">
                  {item.value.toLocaleString("en-US")}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
