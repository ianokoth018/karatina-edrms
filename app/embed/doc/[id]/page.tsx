import { db } from "@/lib/db";
import { verifyDocEmbedToken } from "@/lib/embed-token";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}

/**
 * Public-by-token embed page. Validates the signed embed token, then
 * renders a minimal HTML shell with an `<iframe>` pointing at the
 * token-protected file streamer. Designed to be loaded inside an
 * external system's modal/lightbox.
 */
export default async function EmbeddedDocumentPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { token } = await searchParams;
  if (!token) {
    return <ErrorShell title="Missing token" />;
  }
  const v = verifyDocEmbedToken(token);
  if (!v.ok) {
    return <ErrorShell title="Invalid embed token" detail={v.reason} />;
  }
  if (v.documentId !== id) {
    return <ErrorShell title="Token / document mismatch" />;
  }
  const doc = await db.document.findUnique({
    where: { id },
    select: { id: true, title: true, referenceNumber: true },
  });
  if (!doc) {
    return <ErrorShell title="Document not found" />;
  }

  const fileSrc = `/embed/doc/${id}/file?token=${encodeURIComponent(token)}#view=FitH&zoom=page-width&toolbar=1&navpanes=0`;

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-700 bg-neutral-800 px-4 py-2 text-sm text-neutral-100">
        <div className="truncate">
          <span className="font-mono text-neutral-400">
            {doc.referenceNumber}
          </span>
          <span className="ml-2">{doc.title}</span>
        </div>
        <span className="text-xs text-neutral-400">Embedded view</span>
      </header>
      <iframe
        src={fileSrc}
        className="flex-1 w-full border-0"
        title={`Document ${doc.referenceNumber}`}
      />
    </div>
  );
}

function ErrorShell({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-neutral-900 p-6 text-center">
      <div className="max-w-md rounded-md border border-red-700 bg-neutral-800 p-6">
        <div className="text-xl font-semibold text-red-300">{title}</div>
        {detail && <div className="mt-2 text-sm text-neutral-300">{detail}</div>}
      </div>
    </div>
  );
}
