"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AtSign, LayoutDashboard, Mail, Plus, Send, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/campaigns", label: "Campaigns", icon: Mail },
  { href: "/senders", label: "Senders", icon: AtSign },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Fixed left sidebar on md+ */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar backdrop-blur-xl backdrop-saturate-150 md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-gmail-blue to-gmail-red text-white shadow-sm shadow-gmail-blue/30">
            <Send className="size-4" />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            Outreach
          </span>
        </div>
        <div className="p-3">
          <Button asChild className="w-full gap-2">
            <Link href="/campaigns/new">
              <Plus className="size-4" />
              New Campaign
            </Link>
          </Button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(href)
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Top horizontal nav on small screens */}
      <nav className="sticky top-0 z-40 flex items-center gap-1 overflow-x-auto border-b border-sidebar-border bg-sidebar px-3 py-2 backdrop-blur-xl backdrop-saturate-150 md:hidden">
        <Link
          href="/dashboard"
          className="mr-2 flex shrink-0 items-center gap-2"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-gmail-blue to-gmail-red text-white shadow-sm shadow-gmail-blue/30">
            <Send className="size-3.5" />
          </span>
          <span className="font-semibold tracking-tight">Outreach</span>
        </Link>
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
              isActive(href)
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
        <Button asChild size="sm" className="ml-auto shrink-0 gap-1.5">
          <Link href="/campaigns/new">
            <Plus className="size-4" />
            New
          </Link>
        </Button>
      </nav>
    </>
  );
}
