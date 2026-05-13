"use client";

import { use, useCallback, useEffect, useState } from "react";

interface MatterInfo {
  name: string;
  matterNumber: string;
  status: string;
  description: string | null;
}
interface CustodianInfo {
  name: string;
  email: string | null;
}
interface AckPayload {
  valid: boolean;
  reason?: string;
  acknowledged?: boolean;
  acknowledgedAt?: string | null;
  sentAt?: string;
  matter?: MatterInfo;
  custodian?: CustodianInfo;
}

// ---------------------------------------------------------------------------
// Public legal-hold acknowledgement page. No auth — the URL itself is the
// authentication (HMAC-signed ackToken). proxy.ts whitelists this path.
// ---------------------------------------------------------------------------

export default function LegalHoldAckPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [info, setInfo] = useState<AckPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [acked, setAcked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/legal-hold/ack/${encodeURIComponent(token)}`);
      const data = (await res.json()) as AckPayload;
      setInfo(data);
      if (data.acknowledged) setAcked(true);
    } catch {
      setInfo({ valid: false, reason: "error" });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function submitAck() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/legal-hold/ack/${encodeURIComponent(token)}`, {
        method: "POST",
      });
      const data = (await res.json()) as { ok: boolean; reason?: string };
      if (!data.ok) {
        setError(
          data.reason === "invalid"
            ? "This link is no longer valid."
            : "Could not record acknowledgement. Please try again."
        );
        return;
      }
      setAcked(true);
      await load();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-5 h-5 border-2 border-gray-300 border-t-[#02773b] rounded-full animate-spin" />
          Loading notice…
        </div>
      </Shell>
    );
  }

  if (!info?.valid) {
    return (
      <Shell>
        <div className="rounded-2xl bg-red-50 border border-red-200 p-6">
          <h1 className="text-lg font-semibold text-red-800">Notice link invalid</h1>
          <p className="text-sm text-red-700 mt-2">
            This acknowledgement link is invalid or has expired. Please contact
            the legal team for a fresh link.
          </p>
        </div>
      </Shell>
    );
  }

  const matter = info.matter!;
  const custodian = info.custodian!;

  return (
    <Shell>
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="bg-gradient-to-br from-[#02773b] to-[#014d28] text-white px-6 py-5">
          <div className="text-xs uppercase tracking-wider opacity-80">Legal Hold Notice</div>
          <h1 className="text-xl font-semibold mt-1">{matter.name}</h1>
          <div className="text-xs opacity-80 mt-1">Matter {matter.matterNumber}</div>
        </div>

        <div className="px-6 py-5 space-y-5">
          <section>
            <div className="text-xs text-gray-500 uppercase tracking-wider">Custodian</div>
            <div className="text-sm text-gray-900 mt-1">{custodian.name}</div>
            {custodian.email && (
              <div className="text-xs text-gray-500">{custodian.email}</div>
            )}
          </section>

          {matter.description && (
            <section>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Matter Description</div>
              <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">
                {matter.description}
              </p>
            </section>
          )}

          <section className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900 leading-relaxed">
            <p className="font-semibold mb-2">Your duty to preserve</p>
            <p>
              You have been identified as a custodian of records relevant to
              this matter. You must preserve <b>all</b> paper and electronic
              records — including email, drafts, notes, instant messages, and
              electronic files — that relate to this matter.
            </p>
            <p className="mt-2">
              Do not delete, alter, destroy, or move any such records, and
              suspend any automatic destruction (mailbox cleanup, retention
              schedules, etc.) that might affect them. This duty continues
              until you are formally notified in writing that the hold has been
              released.
            </p>
          </section>

          {acked || info.acknowledged ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-900">
              <div className="font-semibold">Acknowledgement recorded</div>
              <div className="text-xs text-emerald-700 mt-1">
                {info.acknowledgedAt
                  ? `Acknowledged ${new Date(info.acknowledgedAt).toLocaleString()}`
                  : "Acknowledged just now"}
              </div>
              <p className="mt-2">
                Thank you. The legal team has been notified. You can close this
                page.
              </p>
            </div>
          ) : (
            <>
              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              <button
                onClick={submitAck}
                disabled={submitting || matter.status !== "OPEN"}
                className="w-full h-11 rounded-xl bg-[#02773b] text-white font-medium hover:bg-[#014d28] disabled:opacity-60 transition-colors shadow-md shadow-[#02773b]/20"
              >
                {submitting
                  ? "Recording…"
                  : matter.status !== "OPEN"
                    ? "This matter is closed"
                    : "I acknowledge — I will preserve these records"}
              </button>
              <p className="text-xs text-gray-500 text-center">
                Your IP address and the time of this acknowledgement will be
                recorded in the audit log for evidentiary purposes.
              </p>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-xl mx-auto">{children}</div>
    </div>
  );
}
