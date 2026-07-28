import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { countVerdicts } from "@/lib/verification";
import type { VerifyStats } from "@/lib/types";

/** Polled by the results page while a run is in flight. */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const run = await prisma.verificationRun.findFirst({
    where: { id, userId: session.user.id },
    select: { status: true, total: true, processed: true, error: true },
  });
  if (!run) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const counts = await countVerdicts(id);
  const stats: VerifyStats = {
    status: run.status,
    total: run.total,
    processed: run.processed,
    deliverable: counts.deliverable,
    undeliverable: counts.undeliverable,
    risky: counts.risky,
    error: run.error,
  };
  return NextResponse.json(stats);
}
