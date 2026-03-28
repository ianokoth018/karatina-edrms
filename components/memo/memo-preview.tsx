"use client";

/* ========================================================================== */
/*  Types                                                                     */
/* ========================================================================== */

export interface MemoPreviewProps {
  universityName?: string;
  departmentOffice: string; // e.g., "OFFICE OF THE REGISTRAR"
  departmentAbbr: string; // e.g., "ACADEMIC AFFAIRS"
  phone?: string; // e.g., "+254 0716135171/0723683150"
  poBox?: string; // e.g., "P.O Box 1957-10101,KARATINA"
  from: string; // e.g., "Registrar (AA)"
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
/*  Horizontal rule character                                                 */
/* ========================================================================== */

const HR_CHAR = "\u2550"; // ═

/* ========================================================================== */
/*  Component                                                                 */
/* ========================================================================== */

export default function MemoPreview({
  universityName = "KARATINA UNIVERSITY",
  departmentOffice = "OFFICE OF THE REGISTRAR",
  departmentAbbr = "ACADEMIC AFFAIRS",
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
  approver,
}: MemoPreviewProps) {
  return (
    <div
      className="relative bg-white text-black shadow-lg rounded-lg overflow-hidden max-w-[210mm] mx-auto print:shadow-none print:rounded-none"
      style={{
        fontFamily: "'Arial Narrow', Arial, sans-serif",
        fontSize: "12pt",
        lineHeight: "1.4",
      }}
    >
      {/* DRAFT watermark */}
      {isDraft && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 overflow-hidden">
          <span
            className="select-none whitespace-nowrap"
            style={{
              fontSize: "100pt",
              fontWeight: 900,
              color: "rgba(200, 200, 200, 0.3)",
              letterSpacing: "0.2em",
              transform: "rotate(-35deg)",
            }}
          >
            DRAFT
          </span>
        </div>
      )}

      {/* Content wrapper */}
      <div
        className="relative z-20"
        style={{ padding: "12mm 16mm 10mm 16mm" }}
      >
        {/* ---- University Header (centered, bold) ---- */}
        <div style={{ textAlign: "center", marginBottom: "2mm" }}>
          <div
            style={{
              fontWeight: "bold",
              fontSize: "14pt",
              letterSpacing: "1px",
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
          <div
            style={{
              fontWeight: "bold",
              fontSize: "12pt",
              marginTop: "0.5mm",
            }}
          >
            ({departmentAbbr})
          </div>
        </div>

        {/* ---- TEL / P.O. Box line ---- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "11pt",
            marginTop: "2mm",
            marginBottom: "2mm",
          }}
        >
          <span>TEL:{phone}</span>
          <span>{poBox}</span>
        </div>

        {/* ---- Horizontal rule (═══) ---- */}
        <div
          style={{
            fontSize: "10pt",
            lineHeight: "1",
            letterSpacing: "-0.5px",
            overflow: "hidden",
            whiteSpace: "nowrap",
            marginBottom: "3mm",
          }}
        >
          {HR_CHAR.repeat(120)}
        </div>

        {/* ---- INTERNAL MEMO (centered, bold) ---- */}
        <div
          style={{
            textAlign: "center",
            fontWeight: "bold",
            fontSize: "13pt",
            marginBottom: "4mm",
            textDecoration: "underline",
          }}
        >
          INTERNAL MEMO
        </div>

        {/* ---- FROM / DATE line ---- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "2mm",
            fontSize: "12pt",
          }}
        >
          <div>
            <span style={{ fontWeight: "bold" }}>FROM:</span>
            <span style={{ marginLeft: "8px" }}>{from || "---"}</span>
          </div>
          <div>
            <span style={{ fontWeight: "bold" }}>DATE:</span>
            <span style={{ marginLeft: "8px" }}>{date || "---"}</span>
          </div>
        </div>

        {/* ---- TO / REF line ---- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "4mm",
            fontSize: "12pt",
          }}
        >
          <div>
            <span style={{ fontWeight: "bold" }}>TO:</span>
            <span style={{ marginLeft: "24px" }}>{to || "---"}</span>
          </div>
          <div>
            <span style={{ fontWeight: "bold" }}>REF:</span>
            <span style={{ marginLeft: "8px" }}>{refNumber || "---"}</span>
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
            minHeight: "60mm",
            marginBottom: "8mm",
            fontFamily: "'Arial Narrow', Arial, sans-serif",
          }}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />

        {/* ---- Signature area ---- */}
        {(senderName || senderTitle) && (
          <div style={{ marginTop: "10mm", marginBottom: "6mm" }}>
            <div
              style={{
                borderBottom: "1px solid #000",
                width: "50mm",
                marginBottom: "2mm",
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
          <div style={{ marginTop: "8mm", marginBottom: "6mm" }}>
            <div
              style={{
                fontWeight: "bold",
                fontSize: "12pt",
                marginBottom: "3mm",
              }}
            >
              RECOMMENDED BY:
            </div>
            {recommenders.map((rec, index) => (
              <div
                key={index}
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: "8mm",
                  marginBottom: "5mm",
                  fontSize: "11pt",
                }}
              >
                <span
                  style={{
                    width: "6mm",
                    fontWeight: 600,
                    textAlign: "right",
                  }}
                >
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
                  <div style={{ fontSize: "10pt", color: "#444" }}>
                    {rec.name}
                    {rec.title ? `, ${rec.title}` : ""}
                  </div>
                </div>
                <div
                  style={{
                    textAlign: "right",
                    fontSize: "10pt",
                    color: "#666",
                    minWidth: "30mm",
                  }}
                >
                  Date:{" "}
                  {rec.signed && rec.date ? rec.date : "___________"}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ---- Approver ---- */}
        {approver && (
          <div style={{ marginTop: "6mm", marginBottom: "6mm" }}>
            <div
              style={{
                fontWeight: "bold",
                fontSize: "12pt",
                marginBottom: "3mm",
              }}
            >
              APPROVED BY:
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: "8mm",
                fontSize: "11pt",
              }}
            >
              <div style={{ flex: 1 }}>
                {approver.signed ? (
                  <div
                    style={{
                      color: "#02773b",
                      fontStyle: "italic",
                      marginBottom: "1mm",
                    }}
                  >
                    Signed{approver.date ? ` on ${approver.date}` : ""}
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
                <div style={{ fontSize: "10pt", color: "#444" }}>
                  {approver.name}
                  {approver.title ? `, ${approver.title}` : ""}
                </div>
              </div>
              <div
                style={{
                  textAlign: "right",
                  fontSize: "10pt",
                  color: "#666",
                  minWidth: "30mm",
                }}
              >
                Date:{" "}
                {approver.signed && approver.date
                  ? approver.date
                  : "___________"}
              </div>
            </div>
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
