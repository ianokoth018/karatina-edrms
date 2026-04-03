"use client";

/* ========================================================================== */
/*  Types                                                                     */
/* ========================================================================== */

export interface MemoPreviewProps {
  universityName?: string;
  departmentOffice: string; // e.g., "OFFICE OF THE REGISTRAR"
  designation?: string; // e.g., "Registrar (AA)", "ICT Officer", "Dean SESS"
  phone?: string; // e.g., "+254 0716135171/0723683150"
  poBox?: string; // e.g., "P.O Box 1957-10101,KARATINA"
  from: string; // e.g., "Dr. Wangari Gathuthi"
  date: string; // e.g., "23rd March, 2026"
  to: string; // e.g., "Current Students (2025/2026 AY)"
  refNumber: string; // e.g., "KarU/Rg.AA/1/Vol.11"
  subject: string; // e.g., "REMINDER ON FEE PAYMENT"
  bodyHtml: string; // Rich text HTML from editor
  senderName?: string; // e.g., "Dr. Wangari Gathuthi"
  senderTitle?: string; // e.g., "REGISTRAR (AA)"
  copyTo?: string[]; // e.g., ["Vice Chancellor", "Deputy Vice Chancellor (ARSA)", ...]
  isDraft?: boolean;
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

/* ========================================================================== */
/*  Component                                                                 */
/* ========================================================================== */

export default function MemoPreview({
  universityName = "KARATINA UNIVERSITY",
  departmentOffice = "OFFICE OF THE REGISTRAR",
  designation,
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
  recommenders,
  approver: _approver,
}: MemoPreviewProps) {
  // approver is accepted via props for interface compatibility but not rendered
  // on the memo document itself (it is used by the workflow system)
  void _approver;

  /** Build the FROM display: "Name, Designation" if designation provided */
  const fromDisplay = designation
    ? `${from}, ${designation}`
    : from;

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
        {/* ---- University Header with crest ---- */}
        <div style={{ textAlign: "center", marginBottom: "1mm" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "3mm",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/karu-crest.png"
              alt="KarU Crest"
              style={{ height: "14mm", width: "14mm", objectFit: "contain" }}
            />
            <div>
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
                {departmentOffice}
              </div>
            </div>
          </div>
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

        {/* ---- Internal Memo (centered, bold, underlined) ---- */}
        <div
          style={{
            textAlign: "center",
            fontWeight: "bold",
            fontSize: "13pt",
            marginBottom: "3mm",
            textDecoration: "underline",
          }}
        >
          Internal Memo
        </div>

        {/* ---- FROM / DATE row ---- */}
        <div
          style={{
            display: "flex",
            marginBottom: "1.5mm",
            fontSize: "12pt",
          }}
        >
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: "bold" }}>FROM:</span>
            <span style={{ marginLeft: "6px" }}>{fromDisplay || "---"}</span>
          </div>
          <div style={{ textAlign: "right", minWidth: "40%" }}>
            <span style={{ fontWeight: "bold" }}>DATE:</span>
            <span style={{ marginLeft: "4px" }}>{date || "---"}</span>
          </div>
        </div>

        {/* ---- TO / REF row ---- */}
        <div
          style={{
            display: "flex",
            marginBottom: "4mm",
            fontSize: "12pt",
          }}
        >
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: "bold" }}>TO:</span>
            <span style={{ marginLeft: "24px" }}>{to || "---"}</span>
          </div>
          <div style={{ textAlign: "right", minWidth: "40%" }}>
            <span style={{ fontWeight: "bold" }}>REF:</span>
            <span style={{ marginLeft: "6px" }}>{refNumber || "---"}</span>
          </div>
        </div>

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
                }}
              >
                {senderTitle}
              </div>
            )}
          </div>
        )}

        {/* ---- Recommenders ---- */}
        {recommenders && recommenders.length > 0 && (
          <div style={{ marginBottom: "4mm" }}>
            <div
              style={{
                fontWeight: "bold",
                fontSize: "12pt",
                marginBottom: "4mm",
                textDecoration: "underline",
              }}
            >
              RECOMMENDED BY:
            </div>
            {recommenders.map((rec, index) => (
              <div
                key={index}
                style={{
                  marginBottom: "6mm",
                  fontSize: "12pt",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: "4mm",
                    marginBottom: "2mm",
                  }}
                >
                  <span style={{ fontWeight: 600, minWidth: "6mm" }}>
                    {index + 1}.
                  </span>
                  <div style={{ flex: 1 }}>
                    {rec.signed ? (
                      <div
                        style={{
                          color: "#02773b",
                          fontStyle: "italic",
                          marginBottom: "1mm",
                        }}
                      >
                        Signed{rec.date ? ` on ${rec.date}` : ""}
                      </div>
                    ) : (
                      <div
                        style={{
                          borderBottom: "1px dashed #999",
                          minWidth: "50mm",
                          height: "7mm",
                          marginBottom: "1mm",
                        }}
                      />
                    )}
                    <div style={{ fontWeight: "bold" }}>
                      {rec.name}
                    </div>
                    {rec.title && (
                      <div
                        style={{
                          fontWeight: "bold",
                          textTransform: "uppercase",
                        }}
                      >
                        {rec.title}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontSize: "11pt",
                      color: "#444",
                      minWidth: "30mm",
                    }}
                  >
                    Date:{" "}
                    {rec.signed && rec.date ? rec.date : "___________"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ---- Copy to: (two-column layout) ---- */}
        {copyTo && copyTo.length > 0 && (
          <div style={{ marginTop: "8mm" }}>
            <div
              style={{
                fontWeight: "bold",
                fontSize: "12pt",
                marginBottom: "2mm",
              }}
            >
              Copy to:
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1mm 16mm",
                paddingLeft: "16mm",
                fontSize: "12pt",
              }}
            >
              {copyTo.map((name, index) => (
                <div key={index}>{name}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
