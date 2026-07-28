import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { AppSidebar } from "@/components/app-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReauthBanner } from "@/components/reauth-banner";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [dbUser, draftCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { needsReauth: true },
    }),
    prisma.campaignDraft.count({ where: { userId: session.user.id } }),
  ]);

  const displayName = session.user.name ?? session.user.email ?? "Account";
  const email = session.user.email ?? "";
  const initials = initialsOf(displayName);

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar draftCount={draftCount} />
      <div className="flex min-h-screen flex-col md:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-sidebar-border bg-background/60 px-4 backdrop-blur-xl backdrop-saturate-150 md:px-6">
          <Breadcrumbs />
          <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label="Account menu"
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-gmail-blue to-gmail-red text-xs font-semibold text-white shadow-sm shadow-gmail-blue/30">
                  {initials}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">
                    {displayName}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {email}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <DropdownMenuItem asChild>
                  <button type="submit" className="w-full cursor-pointer">
                    <LogOut className="size-4" />
                    Sign out
                  </button>
                </DropdownMenuItem>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
            {dbUser?.needsReauth && <ReauthBanner />}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
