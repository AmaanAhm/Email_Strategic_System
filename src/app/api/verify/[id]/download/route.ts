import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { buildBucketSheet, type Bucket } from "@/lib/verification";

const BUCKETS = new Set<Bucket>(["clean", "risky"]);

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const requested = request.nextUrl.searchParams.get("bucket") ?? "clean";
  if (!BUCKETS.has(requested as Bucket)) {
    return NextResponse.json({ error: "Unknown bucket" }, { status: 400 });
  }
  const bucket = requested as Bucket;

  // Ownership is checked before the sheet is built, not after.
  const run = await prisma.verificationRun.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!run) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sheet = await buildBucketSheet(id, bucket);
  if (!sheet) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isCsv = sheet.fileName.toLowerCase().endsWith(".csv");
  return new NextResponse(new Uint8Array(sheet.buffer), {
    headers: {
      "Content-Type": isCsv
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // encodeURIComponent so a non-ASCII original filename cannot break the header.
      "Content-Disposition": `attachment; filename="${sheet.fileName.replace(/["\\]/g, "")}"; filename*=UTF-8''${encodeURIComponent(sheet.fileName)}`,
      "Content-Length": String(sheet.buffer.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
