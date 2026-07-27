"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, FolderOpen } from "lucide-react";

import { Input } from "@/components/ui/input";

export interface GroupRow {
  id: string;
  name: string;
  count: number;
  createdLabel: string;
}

export function GroupsList({ groups }: { groups: GroupRow[] }) {
  const [filter, setFilter] = React.useState("");
  const query = filter.trim().toLowerCase();
  const filtered = query
    ? groups.filter((g) => g.name.toLowerCase().includes(query))
    : groups;

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search groups..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full sm:max-w-sm"
      />

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No groups match your search.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((g) => (
            <Link
              key={g.id}
              href={`/contacts/${g.id}`}
              className="group glass flex items-center justify-between gap-3 rounded-2xl p-4 transition-colors hover:bg-accent"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gmail-blue to-gmail-green text-white shadow-sm">
                  <FolderOpen className="size-5" />
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium group-hover:underline">
                    {g.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {g.count} contact{g.count === 1 ? "" : "s"} · {g.createdLabel}
                  </div>
                </div>
              </div>
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
