"use client";

import { forwardRef } from "react";
import type { MemoPreviewProps } from "./memo-preview";

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
    },
    refProp
  ) {
    // approver is accepted via props for interface compatibility but not rendered
    // on the memo document itself (it is used by the workflow system)
    void _approver;

    const { main: officeMain, sub: officeSub } = splitOfficeTitle(departmentOffice);

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
              padding: 0 !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            @page {
              size: A4;
              margin: 20mm 25mm;
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
              transform: "translate(-50%, -50%) rotate(-45deg)",
              fontSize: "120pt",
              fontWeight: 900,
              color: "rgba(0, 0, 0, 0.06)",
              letterSpacing: "0.15em",
              pointerEvents: "none",
              zIndex: 1,
              whiteSpace: "nowrap",
              userSelect: "none",
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
            padding: "10mm 18mm",
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
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginTop: "2mm",
              marginBottom: "1.5mm",
            }}
          >
            <tbody>
              <tr>
                <td style={{ fontSize: "10pt", textAlign: "left", padding: 0 }}>
                  TEL:{phone}
                </td>
                <td style={{ fontSize: "10pt", textAlign: "right", padding: 0 }}>
                  {poBox}
                </td>
              </tr>
            </tbody>
          </table>

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
            <table
              key={row.label}
              style={{
                width: "100%",
                borderCollapse: "collapse",
                marginBottom: "5mm",
              }}
            >
              <tbody>
                <tr>
                  <td style={{ fontSize: "12pt", padding: 0 }}>
                    <strong>{row.label}</strong>
                    <span style={{ marginLeft: row.spacing }}>
                      {row.value || "---"}
                    </span>
                  </td>
                  <td
                    style={{
                      fontSize: "12pt",
                      textAlign: "right",
                      padding: 0,
                      minWidth: "40%",
                    }}
                  >
                    {idx === 0 ? (
                      <>
                        <strong>DATE:</strong>
                        <span style={{ marginLeft: "4px" }}>
                          {date || "---"}
                        </span>
                      </>
                    ) : (
                      <>
                        <strong>REF:</strong>
                        <span style={{ marginLeft: "6px" }}>
                          {refNumber || "---"}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          ))}

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
              <table
                style={{
                  borderCollapse: "collapse",
                  fontSize: "12pt",
                }}
              >
                <tbody>
                  {copyTo.map((name, index) => (
                    <tr key={index}>
                      {index === 0 && (
                        <td
                          style={{
                            fontWeight: "bold",
                            verticalAlign: "top",
                            padding: "0 12px 0 0",
                            whiteSpace: "nowrap",
                          }}
                          rowSpan={copyTo.length}
                        >
                          Copy to:
                        </td>
                      )}
                      <td style={{ padding: "0 0 1px 0", verticalAlign: "top" }}>
                        {name}
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
