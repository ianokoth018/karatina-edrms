import { redirect } from "next/navigation";
import { db } from "@/lib/db";

/**
 * Public shared-document entry point.
 *
 * For valid tokens we simply forward the browser to the streaming endpoint
 * so the user sees the document directly in their browser's native viewer —
 * no wrapper UI, no internal metadata, no branding chrome.  The underlying
 * /api/shared/[token] endpoint enforces all ACL, audit, and expiry logic
 * and sets Content-Disposition: inline.
 *
 * Invalid/revoked/expired tokens render a friendly error card instead of
 * a confusing browser error.
 */
export default async function SharedDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const link = await db.documentShareLink.findUnique({
    where: { token },
    select: { id: true, expiresAt: true, revokedAt: true },
  });

  const now = Date.now();
  const notFound = !link;
  const revoked = !notFound && link!.revokedAt !== null;
  const expired =
    !notFound &&
    !revoked &&
    link!.expiresAt !== null &&
    link!.expiresAt.getTime() < now;

  if (!notFound && !revoked && !expired) {
    redirect(`/api/shared/${token}`);
  }

  const message = notFound
    ? "This share link is invalid or no longer exists."
    : revoked
      ? "This share link has been revoked by the document owner."
      : "This share link has expired and is no longer accessible.";
  const title = notFound
    ? "Link not found"
    : revoked
      ? "Link revoked"
      : "Link expired";

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-gray-50">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900 mb-3">{title}</h1>
        <p className="text-sm text-gray-600 leading-relaxed mb-3">{message}</p>
        <p className="text-xs text-gray-500">
          If you believe this is a mistake, please contact the person who shared the document with you.
        </p>
      </div>
    </main>
  );
}
