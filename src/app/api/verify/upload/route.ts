import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createFileRun } from "@/lib/verification";
import { MAX_SHEET_BYTES, parseSheet, SheetError } from "@/lib/sheet";

/**
 * A route handler rather than a server action: server actions cap request
 * bodies at 1MB, and a 500-row sheet with many columns can exceed that.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // Reject an oversized body before formData() pulls it into memory.
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > MAX_SHEET_BYTES) {
    return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 413 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_SHEET_BYTES) {
      return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());

    let sheet;
    try {
      sheet = await parseSheet(buf, file.name);
    } catch (err) {
      // SheetError messages are written for the user and are safe to show.
      if (err instanceof SheetError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    const runId = await createFileRun(userId, file.name, sheet);
    return NextResponse.json({ runId, total: sheet.rows.length });
  } catch (err) {
    console.error("Verification upload failed:", err);
    return NextResponse.json(
      { error: "Something went wrong reading that file" },
      { status: 500 },
    );
  }
}
