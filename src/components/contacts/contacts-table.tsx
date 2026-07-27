"use client";

import * as React from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteContact,
  clearGroupContacts,
} from "@/app/(app)/contacts/actions";
import { avatarClasses, initials } from "@/lib/avatar";
import { cn } from "@/lib/utils";

export interface SerializedContact {
  id: string;
  name: string;
  company: string;
  email: string;
  website: string | null;
  industry: string | null;
  createdAt: string;
}

function websiteHref(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

export function ContactsTable({
  contacts,
  groupId,
}: {
  contacts: SerializedContact[];
  groupId: string;
}) {
  const [filter, setFilter] = React.useState("");
  const [clearDialogOpen, setClearDialogOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const query = filter.trim().toLowerCase();
  const filtered = query
    ? contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.company.toLowerCase().includes(query) ||
          c.email.toLowerCase().includes(query)
      )
    : contacts;

  function handleDelete(id: string) {
    startTransition(async () => {
      try {
        await deleteContact(id, groupId);
        toast.success("Contact deleted");
      } catch {
        toast.error("Failed to delete contact");
      }
    });
  }

  function handleClearAll() {
    startTransition(async () => {
      try {
        await clearGroupContacts(groupId);
        setClearDialogOpen(false);
        toast.success("All contacts deleted");
      } catch {
        toast.error("Failed to delete contacts");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          placeholder="Filter by name, company, or email..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full sm:max-w-sm"
        />
        {contacts.length > 0 && (
          <Button
            variant="destructive"
            onClick={() => setClearDialogOpen(true)}
            disabled={isPending}
          >
            <Trash2 data-icon="inline-start" />
            Delete all
          </Button>
        )}
      </div>

      <div className="glass overflow-x-auto rounded-2xl">
        <Table className="[&_td]:py-3 [&_th]:py-3">
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-12 text-right">S.No</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Website</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr:nth-child(even)]:bg-muted/20">
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-24 text-center text-muted-foreground"
                >
                  No contacts match your filter.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((contact, index) => (
                <TableRow key={contact.id}>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {index + 1}
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                          avatarClasses(contact.email || contact.name),
                        )}
                      >
                        {initials(contact.name)}
                      </span>
                      <span className="truncate">{contact.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>{contact.company}</TableCell>
                  <TableCell>{contact.email}</TableCell>
                  <TableCell>
                    {contact.website ? (
                      <a
                        href={websiteHref(contact.website)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <span className="max-w-40 truncate">
                          {contact.website}
                        </span>
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {contact.industry ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(contact.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm">
                          <MoreHorizontal />
                          <span className="sr-only">
                            Actions for {contact.name}
                          </span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={isPending}
                          onSelect={() => handleDelete(contact.id)}
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all contacts in this group?</DialogTitle>
            <DialogDescription>
              This will permanently delete all {contacts.length} contact
              {contacts.length === 1 ? "" : "s"} in this group. This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => setClearDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={handleClearAll}
            >
              {isPending ? (
                <>
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete all"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
