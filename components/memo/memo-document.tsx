"use client";

import { forwardRef } from "react";
import type { MemoPreviewProps } from "./memo-preview";

/* ========================================================================== */
/*  Horizontal rule character                                                 */
/* ========================================================================== */

const HR_CHAR = "\u2550"; // ═

/* ========================================================================== */
/*  Printable / downloadable memo document                                    */
/*                                                                            */
/*  Same layout as MemoPreview but uses ONLY inline styles (no Tailwind)      */
/*  for reliable print / PDF output. A4 page dimensions.                      */
/* ========================================================================== */

const MemoDocument = forwardRef<HTMLDivElement, MemoPreviewProps>(
  function MemoDocument(
    {
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
    },
    refProp
  ) {
    return (
      <div
        ref={refProp}
        className="memo-print-document"
        style={{
          width: "210mm",
          minHeight: "297mm",
          margin: "0 auto",
          padding: "0",
          fontFamily: "'Arial Narrow', Arial, sans-serif",
          fontSize: "12pt",
          lineHeight: "1.4",
          position: "relative",
          backgroundColor: "#fff",
          color: "#000",
        }}
      >
        {/* Inline print styles */}
        <style>{`
          @media print {
            body * { visibility: hidden !important; }
            .memo-print-document,
            .memo-print-document * { visibility: visible !important; }
            .memo-print-document {
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              margin: 0 !important;
              padding: 15mm 20mm !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            @page {
              size: A4;
              margin: 10mm 15mm;
            }
            .no-print { display: none !important; }
          }
        `}</style>

        {/* DRAFT watermark */}
        {isDraft && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%) rotate(-35deg)",
              fontSize: "100pt",
              fontWeight: 900,
              color: "rgba(200,200,200,0.3)",
              letterSpacing: "0.2em",
              pointerEvents: "none",
              zIndex: 1,
              whiteSpace: "nowrap",
            }}
          >
            DRAFT
          </div>
        )}

        {/* Content wrapper */}
        <div
          style={{
            position: "relative",
            zIndex: 2,
            padding: "15mm 20mm",
          }}
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
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginTop: "2mm",
              marginBottom: "2mm",
            }}
          >
            <tbody>
              <tr>
                <td style={{ fontSize: "11pt", textAlign: "left" }}>
                  TEL:{phone}
                </td>
                <td style={{ fontSize: "11pt", textAlign: "right" }}>
                  {poBox}
                </td>
              </tr>
            </tbody>
          </table>

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
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginBottom: "2mm",
            }}
          >
            <tbody>
              <tr>
                <td style={{ fontSize: "12pt" }}>
                  <strong>FROM:</strong>
                  <span style={{ marginLeft: "8px" }}>
                    {from || "---"}
                  </span>
                </td>
                <td style={{ fontSize: "12pt", textAlign: "right" }}>
                  <strong>DATE:</strong>
                  <span style={{ marginLeft: "8px" }}>
                    {date || "---"}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          {/* ---- TO / REF line ---- */}
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginBottom: "4mm",
            }}
          >
            <tbody>
              <tr>
                <td style={{ fontSize: "12pt" }}>
                  <strong>TO:</strong>
                  <span style={{ marginLeft: "24px" }}>
                    {to || "---"}
                  </span>
                </td>
                <td style={{ fontSize: "12pt", textAlign: "right" }}>
                  <strong>REF:</strong>
                  <span style={{ marginLeft: "8px" }}>
                    {refNumber || "---"}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          {/* ---- RE: subject line (bold, underlined) ---- */}
          <div style={{ marginBottom: "5mm", fontSize: "12pt" }}>
            <strong>RE: </strong>
            <span
              style={{ fontWeight: "bold", textDecoration: "underline" }}
            >
              {subject || "---"}
            </span>
          </div>

          {/* ---- Body (rendered HTML preserving user font choices) ---- */}
          <div
            style={{
              fontSize: "12pt",
              lineHeight: "1.5",
              minHeight: "80mm",
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
              <table
                style={{
                  borderCollapse: "collapse",
                  marginLeft: "16mm",
                  fontSize: "12pt",
                }}
              >
                <tbody>
                  {Array.from({
                    length: Math.ceil(copyTo.length / 2),
                  }).map((_, rowIdx) => (
                    <tr key={rowIdx}>
                      <td
                        style={{
                          paddingRight: "16mm",
                          paddingBottom: "1mm",
                          verticalAlign: "top",
                        }}
                      >
                        {copyTo[rowIdx * 2] || ""}
                      </td>
                      <td
                        style={{
                          paddingBottom: "1mm",
                          verticalAlign: "top",
                        }}
                      >
                        {copyTo[rowIdx * 2 + 1] || ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }
);

export default MemoDocument;
