import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { enforceAdminRateLimit } from "@/lib/rate-limit-admin";

/**
 * POST /api/admin/backup/run
 *
 * Manual backup trigger. Inserts a placeholder BackupLog row immediately
 * (status=PENDING), spawns `scripts/backup.ts` as a detached child
 * process, and returns 202 with the row id so the client can poll
 * /api/admin/backup/list for completion.
 *
 * The child process writes its own SUCCESS / FAILED row when finished;
 * the placeholder is updated to status=RUNNING here so the UI shows it
 * while it executes. We don't await the child — manual backups can take
 * minutes for large uploads/, and we must not block the request.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.user.permissions?.includes("admin:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const __rateLimit = await enforceAdminRateLimit(req, session);
  if (__rateLimit) return __rateLimit;

  // Placeholder row — flipped to SUCCESS / FAILED by the child process
  // when it inserts its own row. We keep this RUNNING row so the UI has
  // something to show during the (potentially long) backup.
  const placeholder = await db.backupLog.create({
    data: {
      type: "manual",
      durationMs: 0,
      status: "RUNNING",
    },
  });

  await writeAudit({
    userId: session.user.id as string,
    action: "backup.manual_trigger",
    resourceType: "backup",
    resourceId: placeholder.id,
  });

  try {
    const scriptPath = path.join(process.cwd(), "scripts", "backup.ts");
    const child = spawn("npx", ["tsx", scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    // Detach so the child outlives this HTTP request.
    child.unref();

    // When the child exits we update the RUNNING placeholder. The child
    // also writes its own SUCCESS / FAILED row — the UI dedupes by
    // showing the RUNNING row's final state.
    child.on("exit", (code) => {
      const status = code === 0 ? "SUCCESS" : "FAILED";
      void db.backupLog
        .update({
          where: { id: placeholder.id },
          data: {
            status,
            error: code === 0 ? null : `child exited ${code}`,
          },
        })
        .catch((err) =>
          logger.error("backup.run: failed to update placeholder", err, {
            placeholderId: placeholder.id,
          })
        );
    });
  } catch (err) {
    logger.error("backup.run: failed to spawn child", err);
    await db.backupLog
      .update({
        where: { id: placeholder.id },
        data: {
          status: "FAILED",
          error: err instanceof Error ? err.message : String(err),
        },
      })
      .catch(() => undefined);
    return NextResponse.json(
      { error: "Failed to start backup" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { ok: true, backupLogId: placeholder.id },
    { status: 202 }
  );
}
