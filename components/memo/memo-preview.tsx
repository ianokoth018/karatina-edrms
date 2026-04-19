"use client";

/* ========================================================================== */
/*  Types                                                                     */
/* ========================================================================== */

export interface MemoPreviewProps {
  universityName?: string;
  departmentOffice: string; // e.g., "OFFICE OF THE REGISTRAR (ACADEMIC AFFAIRS)"
  designation?: string; // e.g., "Registrar (AA)", "ICT Officer", "Dean SESS"
  phone?: string; // e.g., "+254 0716135171/0723683150"
  poBox?: string; // e.g., "P.O Box 1957-10101,KARATINA"
  from: string; // e.g., "Registrar (AA)" — the position/title
  date: string; // e.g., "9th April, 2026"
  to: string; // e.g., "All Current Students (2025/2026 AY)"
  refNumber: string; // e.g., "KarU/Rg.AA/1/Vol.11"
  subject: string; // e.g., "SUSPENSION OF LEARNING ON FRIDAY, 10TH APRIL, 2026"
  bodyHtml: string; // Rich text HTML from editor
  senderName?: string; // e.g., "Dr. Wangari Gathuthi"
  senderTitle?: string; // e.g., "REGISTRAR (AA)"
  copyTo?: string[]; // e.g., ["Vice Chancellor", "Deputy Vice Chancellor (ARSA)", ...]
  isDraft?: boolean;
  /** When true (default), FROM row appears first; when false, TO row appears first. */
  senderIsSuperior?: boolean;
  recommenders?: {
    name: string;
    title?: string;
    signed?: boolean;
    date?: string;
  }[];
  approver?: {
    name: string;
    title?: string;
    signed?: boolean;
    date?: string;
  };
}

/**
 * Split a department office string into main title + optional sub-department.
 * e.g., "OFFICE OF THE REGISTRAR (ACADEMIC AFFAIRS)" → ["OFFICE OF THE REGISTRAR", "(ACADEMIC AFFAIRS)"]
 */
function splitOfficeTitle(office: string): { main: string; sub?: string } {
  const match = office.match(/^(.+?)\s*(\([^)]+\))$/);
  if (match) {
    return { main: match[1].trim(), sub: match[2] };
  }
  return { main: office };
}

/* ========================================================================== */
/*  Component                                                                 */
/* ========================================================================== */

export default function MemoPreview({
  universityName = "KARATINA UNIVERSITY",
  departmentOffice = "OFFICE OF THE REGISTRAR",
  phone = "+254 0716135171/0723683150",
  poBox = "P.O Box 1957-10101,KARATINA",
  from,
  date,
  to,
  refNumber,
  subject,
  bodyHtml,
  senderName,
  senderTitle,
  copyTo,
  isDraft = true,
  senderIsSuperior = true,
  recommenders,
  approver: _approver,
}: MemoPreviewProps) {
  // approver is accepted via props for interface compatibility but not rendered
  // on the memo document itself (it is used by the workflow system)
  void _approver;

  const { main: officeMain, sub: officeSub } = splitOfficeTitle(departmentOffice);

  return (
    <div
      className="relative bg-white text-black shadow-lg overflow-hidden mx-auto print:shadow-none"
      style={{
        fontFamily: "'Arial Narrow', Arial, sans-serif",
        fontSize: "12pt",
        lineHeight: "1.4",
        maxWidth: "210mm",
        minHeight: "297mm",
      }}
    >
      {/* DRAFT watermark */}
      {isDraft && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden"
          style={{ zIndex: 1 }}
        >
          <span
            className="select-none whitespace-nowrap"
            style={{
              fontSize: "120pt",
              fontWeight: 900,
              color: "rgba(0, 0, 0, 0.06)",
              letterSpacing: "0.15em",
              transform: "rotate(-45deg)",
            }}
          >
            DRAFT
          </span>
        </div>
      )}

      {/* Content wrapper */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          padding: "10mm 18mm 10mm 18mm",
        }}
      >
        {/* ---- University Header (text only, no crest) ---- */}
        <div style={{ textAlign: "center", marginBottom: "1mm" }}>
          <div
            style={{
              fontWeight: "bold",
              fontSize: "16pt",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
            }}
          >
            {universityName}
          </div>
          <div
            style={{
              fontWeight: "bold",
              fontSize: "12pt",
              marginTop: "1mm",
            }}
          >
            {officeMain}
          </div>
          {officeSub && (
            <div
              style={{
                fontWeight: "bold",
                fontSize: "12pt",
                marginTop: "0.5mm",
              }}
            >
              {officeSub}
            </div>
          )}
        </div>

        {/* ---- TEL / P.O. Box line ---- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "10pt",
            marginTop: "2mm",
            marginBottom: "1.5mm",
          }}
        >
          <span>TEL:{phone}</span>
          <span>{poBox}</span>
        </div>

        {/* ---- Horizontal rule (solid line) ---- */}
        <div
          style={{
            borderTop: "2px solid #000",
            marginBottom: "4mm",
          }}
        />

        {/* ---- INTERNAL MEMO (centered, bold) ---- */}
        <div
          style={{
            textAlign: "center",
            fontWeight: "bold",
            fontSize: "13pt",
            marginBottom: "3mm",
          }}
        >
          INTERNAL MEMO
        </div>

        {/* ---- Row 1 & 2: FROM/TO order depends on seniority ---- */}
        {/* Superior sender → FROM first; subordinate sender → TO first */}
        {(senderIsSuperior
          ? [
              { label: "FROM:", value: from, spacing: "6px" },
              { label: "TO:", value: to, spacing: "24px" },
            ]
          : [
              { label: "TO:", value: to, spacing: "24px" },
              { label: "FROM:", value: from, spacing: "6px" },
            ]
        ).map((row, idx) => (
          <div
            key={row.label}
            style={{
              display: "flex",
              marginBottom: "5mm",
              fontSize: "12pt",
            }}
          >
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: "bold" }}>{row.label}</span>
              <span style={{ marginLeft: row.spacing }}>{row.value || "---"}</span>
            </div>
            <div style={{ textAlign: "right", minWidth: "40%" }}>
              {idx === 0 ? (
                <>
                  <span style={{ fontWeight: "bold" }}>DATE:</span>
                  <span style={{ marginLeft: "4px" }}>{date || "---"}</span>
                </>
              ) : (
                <>
                  <span style={{ fontWeight: "bold" }}>REF:</span>
                  <span style={{ marginLeft: "6px" }}>{refNumber || "---"}</span>
                </>
              )}
            </div>
          </div>
        ))}

        {/* ---- RE: subject line (bold, underlined) ---- */}
        <div
          style={{
            marginBottom: "5mm",
            fontSize: "12pt",
          }}
        >
          <span style={{ fontWeight: "bold" }}>RE: </span>
          <span
            style={{
              fontWeight: "bold",
              textDecoration: "underline",
            }}
          >
            {subject || "---"}
          </span>
        </div>

        {/* ---- Body (rendered HTML preserving user font choices) ---- */}
        <div
          className="memo-body-content"
          style={{
            fontSize: "12pt",
            lineHeight: "1.5",
            minHeight: "40mm",
            marginBottom: "6mm",
            fontFamily: "'Arial Narrow', Arial, sans-serif",
          }}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />

        {/* ---- Initiator / Sender signature ---- */}
        {(senderName || senderTitle) && (
          <div style={{ marginBottom: "6mm" }}>
            <div
              style={{
                borderBottom: "1px dashed #999",
                minWidth: "50mm",
                maxWidth: "60mm",
                height: "7mm",
                marginBottom: "1mm",
              }}
            />
            {senderName && (
              <div style={{ fontWeight: "bold", fontSize: "12pt" }}>
                {senderName}
              </div>
            )}
            {senderTitle && (
              <div
                style={{
                  fontWeight: "bold",
                  fontSize: "12pt",
                  textTransform: "uppercase",
                  textDecoration: "underline",
                }}
              >
                {senderTitle}
              </div>
            )}
          </div>
        )}

        {/* ---- Copy to: (single-column indented list) ---- */}
        {copyTo && copyTo.length > 0 && (
          <div style={{ marginTop: "8mm" }}>
            <div
              style={{
                display: "flex",
                fontSize: "12pt",
              }}
            >
              <span style={{ fontWeight: "bold", whiteSpace: "nowrap" }}>
                Copy to:
              </span>
              <div style={{ marginLeft: "12px" }}>
                {copyTo.map((name, index) => (
                  <div key={index}>{name}</div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
