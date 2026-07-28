import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { parseContactsFile } from "@/lib/import-contacts";
import type { ImportResult } from "@/lib/types";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXTENSIONS = new Set(["csv", "xlsx", "xls"]);

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // Reject oversized bodies before formData() materializes them in memory.
  const declaredSize = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10
  );
  if (Number.isFinite(declaredSize) && declaredSize > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File too large (max 5MB)" },
      { status: 413 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const groupId = formData.get("groupId");
    const newGroupName = formData.get("newGroupName");

    // Either import into an existing group, or create one from this file. The
    // second form exists so a group can never come into being empty.
    const creatingGroup = typeof newGroupName === "string" && newGroupName.trim().length > 0;

    if (!creatingGroup) {
      if (typeof groupId !== "string" || !groupId) {
        return NextResponse.json(
          { error: "No group specified" },
          { status: 400 },
        );
      }
      const group = await prisma.contactGroup.findFirst({
        where: { id: groupId, userId },
        select: { id: true },
      });
      if (!group) {
        return NextResponse.json({ error: "Group not found" }, { status: 404 });
      }
    } else if (newGroupName.trim().length > 80) {
      return NextResponse.json(
        { error: "Group name is too long (max 80)" },
        { status: 400 },
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 5MB)" },
        { status: 400 }
      );
    }
    const extension = file.name.includes(".")
      ? (file.name.split(".").pop() ?? "").toLowerCase()
      : "";
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return NextResponse.json(
        { error: "Unsupported file type. Upload a .csv, .xlsx or .xls file." },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());

    let parsed: Awaited<ReturnType<typeof parseContactsFile>>;
    try {
      parsed = await parseContactsFile(buf, file.name);
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error ? err.message : "Failed to parse the file",
        },
        { status: 400 }
      );
    }

    const { rows, errors } = parsed;

    const contactData = (targetGroupId: string) =>
      rows.map((r) => ({
        name: r.name,
        company: r.company,
        email: r.email,
        website: r.website ?? null,
        industry: r.industry ?? null,
        userId,
        groupId: targetGroupId,
      }));

    if (creatingGroup) {
      // One transaction: if the file yields no usable contact the group is
      // rolled back with it, so an empty group cannot be left behind.
      let outcome: { groupId: string; imported: number };
      try {
        outcome = await prisma.$transaction(async (tx) => {
          const group = await tx.contactGroup.create({
            data: { userId, name: newGroupName.trim() },
          });
          const created = await tx.contact.createMany({
            data: contactData(group.id),
            skipDuplicates: true,
          });
          if (created.count === 0) throw new Error("NO_USABLE_ROWS");
          return { groupId: group.id, imported: created.count };
        });
      } catch (err) {
        if (err instanceof Error && err.message === "NO_USABLE_ROWS") {
          return NextResponse.json(
            {
              error:
                "No valid contacts found in that file, so the group was not created.",
              errors: errors.slice(0, 10),
            },
            { status: 400 },
          );
        }
        throw err;
      }

      const result: ImportResult & { groupId: string } = {
        groupId: outcome.groupId,
        imported: outcome.imported,
        skippedDuplicates: rows.length - outcome.imported,
        errors,
      };
      return NextResponse.json(result);
    }

    const created = await prisma.contact.createMany({
      data: contactData(groupId as string),
      skipDuplicates: true,
    });

    const result: ImportResult = {
      imported: created.count,
      skippedDuplicates: rows.length - created.count,
      errors,
    };
    return NextResponse.json(result);
  } catch (err) {
    console.error("Contact import failed:", err);
    return NextResponse.json(
      { error: "Something went wrong while importing contacts" },
      { status: 500 }
    );
  }
}
