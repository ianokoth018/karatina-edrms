"use client";

/* ---------- types ---------- */

export interface MemoPreviewProps {
  referenceNumber: string;
  date: string;
  to: { name: string; title?: string };
  cc?: { name: string; title?: string }[];
  from: { name: string; title?: string };
  subject: string;
  body: string; // HTML from rich text editor
  recommenders?: {
    name: string;
    title?: string;
    signed?: boolean;
    signedAt?: string;
  }[];
  approver?: {
    name: string;
    title?: string;
    signed?: boolean;
    signedAt?: string;
  };
  isDraft?: boolean;
}

/* ---------- component ---------- */

export default function MemoPreview({
  referenceNumber,
  date,
  to,
  cc,
  from,
  subject,
  body,
  recommenders,
  approver,
  isDraft = true,
}: MemoPreviewProps) {
  return (
    <div className="relative bg-white text-gray-900 shadow-lg rounded-lg overflow-hidden max-w-[210mm] mx-auto print:shadow-none print:rounded-none">
      {/* DRAFT watermark */}
      {isDraft && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 overflow-hidden">
          <span
            className="text-[120px] font-extrabold tracking-[0.2em] text-gray-300/40 select-none whitespace-nowrap"
            style={{ transform: "rotate(-35deg)" }}
          >
            DRAFT
          </span>
        </div>
      )}

      {/* University header */}
      <div className="bg-[#02773b] px-8 py-5 text-center relative z-20">
        <div className="flex items-center justify-center gap-3 mb-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/karu-crest.png"
            alt="Karatina University Crest"
            className="h-10 w-auto object-contain print:h-12"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <h1 className="text-white text-xl font-bold tracking-wider uppercase">
            Karatina University
          </h1>
        </div>
        <div className="w-32 h-px bg-[#dd9f42] mx-auto my-2" />
        <p className="text-white/90 text-sm font-semibold tracking-[0.25em] uppercase">
          Internal Memorandum
        </p>
      </div>

      {/* Gold accent bar */}
      <div className="h-1 bg-gradient-to-r from-[#dd9f42] via-[#f0c060] to-[#dd9f42]" />

      {/* Memo content area */}
      <div className="px-8 py-6 space-y-5 relative z-20">
        {/* Reference and Date */}
        <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
          <p className="text-sm">
            <span className="font-semibold text-gray-600 tracking-wide">
              REF:{" "}
            </span>
            <span className="font-mono text-gray-900">
              {referenceNumber || "---"}
            </span>
          </p>
          <p className="text-sm">
            <span className="font-semibold text-gray-600 tracking-wide">
              DATE:{" "}
            </span>
            <span className="text-gray-900">{date}</span>
          </p>
        </div>

        {/* Horizontal rule */}
        <hr className="border-gray-300" />

        {/* Addressing block */}
        <div className="space-y-1.5 text-sm">
          <div className="flex">
            <span className="font-semibold text-gray-600 w-24 flex-shrink-0 tracking-wide">
              TO:
            </span>
            <span className="text-gray-900 font-medium">
              {to.name}
              {to.title && `, ${to.title}`}
            </span>
          </div>
          {cc && cc.length > 0 && (
            <div className="flex">
              <span className="font-semibold text-gray-600 w-24 flex-shrink-0 tracking-wide">
                CC:
              </span>
              <span className="text-gray-900">
                {cc
                  .map((u) => `${u.name}${u.title ? `, ${u.title}` : ""}`)
                  .join("; ")}
              </span>
            </div>
          )}
          <div className="flex">
            <span className="font-semibold text-gray-600 w-24 flex-shrink-0 tracking-wide">
              FROM:
            </span>
            <span className="text-gray-900">
              {from.name}
              {from.title && `, ${from.title}`}
            </span>
          </div>
          <div className="flex">
            <span className="font-semibold text-gray-600 w-24 flex-shrink-0 tracking-wide">
              SUBJECT:
            </span>
            <span className="text-gray-900 font-semibold">{subject}</span>
          </div>
        </div>

        {/* Horizontal rule */}
        <hr className="border-gray-300" />

        {/* Body - rendered HTML */}
        <div
          className="prose prose-sm max-w-none text-gray-800 leading-relaxed min-h-[120px] [&>*:first-child]:mt-0"
          dangerouslySetInnerHTML={{ __html: body }}
        />

        {/* Horizontal rule before signatures */}
        <hr className="border-gray-300" />

        {/* Recommenders section */}
        {recommenders && recommenders.length > 0 && (
          <div className="space-y-4 pt-2">
            <p className="text-sm font-bold text-gray-700 tracking-wide">
              RECOMMENDED BY:
            </p>
            {recommenders.map((rec, index) => (
              <div key={index} className="flex items-end gap-4 text-sm">
                <span className="text-gray-500 font-semibold w-6 text-right">
                  {index + 1}.
                </span>
                <div className="flex-1">
                  {rec.signed ? (
                    <div className="pb-1 mb-1">
                      <span className="italic text-[#02773b] font-medium">
                        Signed
                      </span>
                      {rec.signedAt && (
                        <span className="text-xs text-gray-400 ml-2">
                          {rec.signedAt}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="border-b border-dashed border-gray-400 pb-1 mb-1 min-w-[200px]" />
                  )}
                  <p className="text-xs text-gray-500">
                    {rec.name}
                    {rec.title && `, ${rec.title}`}
                  </p>
                </div>
                <div className="text-right min-w-[120px]">
                  <p className="text-xs text-gray-400">
                    Date:{" "}
                    {rec.signed && rec.signedAt ? rec.signedAt : "___________"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Approver section */}
        {approver && (
          <div className="space-y-3 pt-2">
            <p className="text-sm font-bold text-gray-700 tracking-wide">
              APPROVED BY:
            </p>
            <div className="flex items-end gap-4 text-sm">
              <div className="flex-1">
                {approver.signed ? (
                  <div className="pb-1 mb-1">
                    <span className="italic text-[#02773b] font-medium">
                      Signed
                    </span>
                    {approver.signedAt && (
                      <span className="text-xs text-gray-400 ml-2">
                        {approver.signedAt}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="border-b border-dashed border-gray-400 pb-1 mb-1 min-w-[200px]" />
                )}
                <p className="text-xs text-gray-500">
                  {approver.name}
                  {approver.title && `, ${approver.title}`}
                </p>
              </div>
              <div className="text-right min-w-[120px]">
                <p className="text-xs text-gray-400">
                  Date:{" "}
                  {approver.signed && approver.signedAt
                    ? approver.signedAt
                    : "___________"}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="relative z-20">
        <div className="h-1 bg-gradient-to-r from-[#dd9f42] via-[#f0c060] to-[#dd9f42]" />
        <div className="bg-[#02773b] px-8 py-3 text-center">
          <p className="text-white/80 text-xs tracking-wider">
            Karatina University &bull; P.O. Box 1957-10101, Karatina, Kenya
          </p>
        </div>
      </div>
    </div>
  );
}
