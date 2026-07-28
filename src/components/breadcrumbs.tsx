"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";

/** Human labels for known route segments. */
const LABELS: Record<string, string> = {
  contacts: "Contacts",
  campaigns: "Campaigns",
  senders: "Senders",
  verify: "Verify your contacts",
  new: "New campaign",
};

function labelFor(segment: string, prev: string | undefined): string {
  if (LABELS[segment]) return LABELS[segment];
  // A dynamic id under /campaigns → the campaign detail page.
  if (prev === "campaigns") return "Details";
  // A dynamic id under /contacts → a contact group page.
  if (prev === "contacts") return "Group";
  // A dynamic id under /verify → one verification run.
  if (prev === "verify") return "Results";
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

type Crumb = { label: string; href: string; current: boolean };

/**
 * Path-derived breadcrumb rendered in the app header, so every page can trace
 * back to the dashboard. The first crumb is always Dashboard (home).
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const onDashboard = segments[0] === "dashboard";
  const crumbs: Crumb[] = [
    {
      label: "Dashboard",
      href: "/dashboard",
      current: onDashboard && segments.length === 1,
    },
  ];

  if (!onDashboard) {
    let href = "";
    segments.forEach((seg, i) => {
      href += `/${seg}`;
      crumbs.push({
        label: labelFor(seg, segments[i - 1]),
        href,
        current: i === segments.length - 1,
      });
    });
  }

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((c, i) => (
          <li key={c.href} className="flex min-w-0 items-center gap-1">
            {i > 0 && (
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground/60"
              />
            )}
            {c.current ? (
              <span
                aria-current="page"
                className="flex items-center gap-1 truncate font-medium text-foreground"
              >
                {i === 0 && (
                  <Home aria-hidden="true" className="size-3.5 shrink-0" />
                )}
                <span className="truncate">{c.label}</span>
              </span>
            ) : (
              <Link
                href={c.href}
                className="flex items-center gap-1 truncate text-muted-foreground transition-colors hover:text-foreground"
              >
                {i === 0 && (
                  <Home aria-hidden="true" className="size-3.5 shrink-0" />
                )}
                <span className="truncate">{c.label}</span>
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
