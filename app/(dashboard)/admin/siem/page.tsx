import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSiemConfig, siemEnabled, SIEM_MAX_ATTEMPTS } from "@/lib/siem";
import { SiemAdminClient } from "./siem-admin-client";

/**
 * Admin → SIEM Audit Forwarding.
 *
 * Server component that loads env-driven config (with secrets masked)
 * plus the last 24h of ship-log counters, then hands off to a small
 * client island for the two interactive buttons (Test shipment,
 * Retry all failed).
 *
 * Like the LDAP / SSO admin pages, secrets live in env vars — the UI
 * only displays *whether* each value is set, never the value itself.
 */
export const dynamic = "force-dynamic";

export default async function SiemAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.permissions?.includes("admin:manage")) {
    return <div className="p-6 text-red-600">Forbidden</div>;
  }

  const cfg = getSiemConfig();
  const enabled = siemEnabled();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [pending, delivered, failed] = await Promise.all([
    db.siemShipLog.count({
      where: { status: "PENDING", createdAt: { gte: since } },
    }),
    db.siemShipLog.count({
      where: { status: "DELIVERED", createdAt: { gte: since } },
    }),
    db.siemShipLog.count({
      where: { status: "FAILED", createdAt: { gte: since } },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">SIEM Audit Forwarding</h1>
        <p className="text-sm text-gray-600 mt-1">
          Forwards every successful audit log entry to an external SIEM
          (Splunk HEC, RFC 5424 syslog over UDP, or a generic JSON HTTP
          endpoint). Delivery is at-least-once and runs in the background
          — it never blocks or fails the original audit write. Failed
          shipments are retried up to {SIEM_MAX_ATTEMPTS} times by the
          shipper worker before being parked for admin review.
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white">
        <header className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <h2 className="font-medium">Transport</h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              enabled
                ? "bg-green-100 text-green-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                enabled ? "bg-green-600" : "bg-amber-600"
              }`}
            />
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </header>

        <dl className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Row label="SIEM_TARGET" value={cfg.target ?? "(unset)"} />

          {cfg.target === "splunk_hec" && (
            <>
              <Row label="SIEM_SPLUNK_URL" value={cfg.splunk.url || "(unset)"} />
              <Row
                label="SIEM_SPLUNK_TOKEN"
                value={
                  cfg.splunk.tokenSet
                    ? cfg.splunk.tokenMasked
                    : "(unset)"
                }
              />
            </>
          )}

          {cfg.target === "syslog_udp" && (
            <>
              <Row label="SIEM_SYSLOG_HOST" value={cfg.syslog.host || "(unset)"} />
              <Row label="SIEM_SYSLOG_PORT" value={String(cfg.syslog.port)} />
            </>
          )}

          {cfg.target === "http_json" && (
            <>
              <Row label="SIEM_HTTP_URL" value={cfg.http.url || "(unset)"} />
              <Row
                label="SIEM_HTTP_AUTH_HEADER"
                value={
                  cfg.http.authHeaderSet
                    ? cfg.http.authHeaderMasked
                    : "(unset)"
                }
              />
            </>
          )}

          {!cfg.target && (
            <div className="col-span-full text-xs text-gray-500 border-t border-gray-100 pt-3">
              Set <code>SIEM_TARGET</code> to one of{" "}
              <code>splunk_hec</code> | <code>syslog_udp</code> |{" "}
              <code>http_json</code> and supply the corresponding URL /
              host / token in env to enable forwarding.
            </div>
          )}
        </dl>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white">
        <header className="border-b border-gray-200 px-4 py-3">
          <h2 className="font-medium">Last 24h</h2>
        </header>
        <dl className="px-4 py-3 grid grid-cols-3 gap-4 text-sm">
          <Stat label="Pending" value={pending} tone="amber" />
          <Stat label="Delivered" value={delivered} tone="green" />
          <Stat label="Failed" value={failed} tone="red" />
        </dl>
      </section>

      <SiemAdminClient enabled={enabled} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="font-mono text-sm break-all">{value}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "green" | "red";
}) {
  const colors: Record<typeof tone, string> = {
    amber: "text-amber-700",
    green: "text-green-700",
    red: "text-red-700",
  };
  return (
    <div className="rounded-md border border-gray-200 p-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className={`text-2xl font-mono ${colors[tone]}`}>{value}</dd>
    </div>
  );
}
