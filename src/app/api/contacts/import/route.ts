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

    const created = await prisma.contact.createMany({
      data: rows.map((r) => ({
        name: r.name,
        company: r.company,
        email: r.email,
        website: r.website ?? null,
        industry: r.industry ?? null,
        userId,
        groupId,
      })),
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
