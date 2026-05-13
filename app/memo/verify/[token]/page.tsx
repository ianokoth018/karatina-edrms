import { db } from "@/lib/db";
import { verifyMemoShareToken } from "@/lib/memo-share";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * Public memo authenticity verification page. Renders WITHOUT auth so anyone
 * scanning the QR on a printed memo can confirm it was produced by this
 * eRegistry system and inspect the signing/approval trail.
 *
 * The token IS the proof: it's HMAC-signed by lib/memo-share. Anyone with
 * the token can read the metadata; the public PDF endpoint at
 * /api/memos/public/[token] regenerates the PDF itself with the same trust.
 */
export default async function MemoVerifyPage({ params }: PageProps) {
  const { token } = await params;
  const v = verifyMemoShareToken(token);
  if (!v.ok) {
    return <NotVerified reason={v.reason} />;
  }
  const memo = await db.workflowInstance.findUnique({
    where: { id: v.memoId },
    select: {
      id: true,
      referenceNumber: true,
      subject: true,
      status: true,
      startedAt: true,
      completedAt: true,
      initiatedById: true,
      document: {
        select: { referenceNumber: true, title: true },
      },
      tasks: {
        orderBy: { stepIndex: "asc" },
        select: {
          stepName: true,
          action: true,
          completedAt: true,
          assignee: {
            select: { displayName: true, name: true, jobTitle: true },
          },
        },
      },
    },
  });
  if (!memo) {
    return <NotVerified reason="Memo not found in the registry." />;
  }
  const initiator = memo.initiatedById
    ? await db.user.findUnique({
        where: { id: memo.initiatedById },
        select: { displayName: true, name: true, jobTitle: true, designation: true },
      })
    : null;

  const memoRef = memo.document?.referenceNumber ?? memo.referenceNumber;
  const subject = memo.subject ?? memo.document?.title ?? "Memorandum";
  const startedAt = new Date(memo.startedAt).toLocaleString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const completedAt = memo.completedAt
    ? new Date(memo.completedAt).toLocaleString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const signers = memo.tasks.filter((t) => t.action && t.completedAt);
  const isSigned =
    memo.status === "COMPLETED" || signers.some((s) => s.action === "APPROVED");

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-lg border border-gray-200 bg-white shadow-sm">
        <div
          className={`rounded-t-lg px-6 py-5 ${
            isSigned ? "bg-green-600" : "bg-amber-500"
          } text-white`}
        >
          <div className="flex items-center gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-8 w-8"
            >
              {isSigned ? (
                <path
                  fillRule="evenodd"
                  d="M2.25 12a9.75 9.75 0 1119.5 0 9.75 9.75 0 01-19.5 0zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
                  clipRule="evenodd"
                />
              ) : (
                <path
                  fillRule="evenodd"
                  d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z"
                  clipRule="evenodd"
                />
              )}
            </svg>
            <div>
              <div className="text-xl font-semibold">
                {isSigned ? "VERIFIED" : "IN PROCESS"}
              </div>
              <div className="text-sm opacity-90">
                {isSigned
                  ? "This memorandum is authentic."
                  : "This memorandum exists in the registry but is not yet fully signed."}
              </div>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-4 px-6 py-6 text-sm sm:grid-cols-2">
          <Field label="Reference number">{memoRef}</Field>
          <Field label="Status">{memo.status}</Field>
          <Field label="Subject" full>
            {subject}
          </Field>
          <Field label="Originator">
            {initiator?.displayName ?? initiator?.name ?? "—"}
            {initiator?.designation && (
              <div className="text-xs text-gray-500">
                {initiator.designation}
              </div>
            )}
          </Field>
          <Field label="Originated">{startedAt}</Field>
          {completedAt && <Field label="Completed">{completedAt}</Field>}
        </dl>

        {signers.length > 0 && (
          <div className="border-t border-gray-100 px-6 py-5">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Signing trail
            </div>
            <ol className="space-y-3 text-sm">
              {signers.map((s, idx) => (
                <li key={idx} className="flex items-start gap-3">
                  <span className="mt-1 inline-block h-2 w-2 flex-shrink-0 rounded-full bg-green-600" />
                  <div className="flex-1">
                    <div className="font-medium text-gray-800">
                      {s.stepName}{" "}
                      <span className="text-xs font-normal text-gray-500">
                        ({s.action})
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {s.assignee?.displayName ?? s.assignee?.name ?? "—"}
                      {s.assignee?.jobTitle && ` — ${s.assignee.jobTitle}`}
                      {s.completedAt &&
                        ` · ${new Date(s.completedAt).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="rounded-b-lg border-t border-gray-100 bg-gray-50 px-6 py-4 text-xs text-gray-500">
          This page was generated on-demand by the eRegistry verification
          service. The original record is held by the issuing authority and
          can be requested directly.
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="mt-1 text-gray-900">{children}</dd>
    </div>
  );
}

function NotVerified({ reason }: { reason: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md rounded-lg border border-red-300 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 text-red-700">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-7 w-7"
          >
            <path
              fillRule="evenodd"
              d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm-1.72 6.97a.75.75 0 10-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 101.06 1.06L12 13.06l1.72 1.72a.75.75 0 101.06-1.06L13.06 12l1.72-1.72a.75.75 0 10-1.06-1.06L12 10.94l-1.72-1.72z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <div className="text-lg font-semibold">NOT VERIFIED</div>
            <div className="mt-1 text-sm text-gray-700">{reason}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
