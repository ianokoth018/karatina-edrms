import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveBackupDir } from "@/lib/backup";
import { BackupAdminClient } from "./backup-admin-client";

/**
 * Admin → Backup & Restore.
 *
 * Server component: loads the last 100 BackupLog rows plus the
 * "next scheduled run" (the next 02:00 local) and hands off to a small
 * client island that renders the table + the manual-trigger button.
 */
export const dynamic = "force-dynamic";

function nextScheduledRun(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setHours(2, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

export default async function BackupAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.permissions?.includes("admin:manage")) {
    return <div className="p-6 text-red-600">Forbidden</div>;
  }

  const rows = await db.backupLog.findMany({
    orderBy: { timestamp: "desc" },
    take: 100,
  });

  const initialEntries = rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp.toISOString(),
    type: r.type,
    dbDumpPath: r.dbDumpPath,
    uploadsPath: r.uploadsPath,
    dbBytes: r.dbBytes != null ? r.dbBytes.toString() : null,
    uploadsBytes: r.uploadsBytes != null ? r.uploadsBytes.toString() : null,
    durationMs: r.durationMs,
    status: r.status,
    error: r.error,
  }));

  const lastSuccess = rows.find((r) => r.status === "SUCCESS");
  const next = nextScheduledRun();
  const backupDir = resolveBackupDir();

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Backup & Restore</h1>
        <p className="text-sm text-gray-600 mt-1">
          Manages Postgres dumps and encrypted uploads/ tarballs. A
          scheduled worker runs daily at 02:00 local and retains the last
          7 daily / 4 weekly / 12 monthly backups. Manual runs are kept
          indefinitely. See{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5">
            docs/DR-RUNBOOK.md
          </code>{" "}
          for the restore procedure.
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white">
        <header className="border-b border-gray-200 px-4 py-3">
          <h2 className="font-medium">Status</h2>
        </header>
        <dl className="px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <Stat
            label="Last successful run"
            value={
              lastSuccess
                ? new Date(lastSuccess.timestamp).toLocaleString()
                : "(none yet)"
            }
          />
          <Stat
            label="Next scheduled run"
            value={next.toLocaleString()}
          />
          <Stat label="Backup directory" value={backupDir} mono />
        </dl>
      </section>

      <BackupAdminClient initialEntries={initialEntries} />
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-gray-200 p-3">
      <dt className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className={`mt-1 ${mono ? "font-mono text-xs break-all" : "text-sm"}`}>
        {value}
      </dd>
    </div>
  );
}
