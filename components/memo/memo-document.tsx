"use client";

import { forwardRef } from "react";
import type { MemoPreviewProps } from "./memo-preview";

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
    },
    refProp
  ) {
    // approver is accepted via props for interface compatibility but not rendered
    // on the memo document itself (it is used by the workflow system)
    void _approver;

    /** Build the FROM display: "Name, Designation" if designation provided */
    const fromDisplay = designation
      ? `${from}, ${designation}`
      : from;

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
          {/* ---- University Header with crest ---- */}
          <div style={{ textAlign: "center", marginBottom: "1mm" }}>
            <table style={{ margin: "0 auto", borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={{ padding: "0 3mm 0 0", verticalAlign: "middle" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/karu-crest.png"
                      alt="KarU Crest"
                      style={{ height: "14mm", width: "14mm", objectFit: "contain" }}
                    />
                  </td>
                  <td style={{ verticalAlign: "middle" }}>
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
                  </td>
                </tr>
              </tbody>
            </table>
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
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginBottom: "1.5mm",
            }}
          >
            <tbody>
              <tr>
                <td style={{ fontSize: "12pt", padding: 0 }}>
                  <strong>FROM:</strong>
                  <span style={{ marginLeft: "6px" }}>
                    {fromDisplay || "---"}
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
                  <strong>DATE:</strong>
                  <span style={{ marginLeft: "4px" }}>
                    {date || "---"}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          {/* ---- TO / REF row ---- */}
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginBottom: "4mm",
            }}
          >
            <tbody>
              <tr>
                <td style={{ fontSize: "12pt", padding: 0 }}>
                  <strong>TO:</strong>
                  <span style={{ marginLeft: "24px" }}>
                    {to || "---"}
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
                  <strong>REF:</strong>
                  <span style={{ marginLeft: "6px" }}>
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
                <table
                  key={index}
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    marginBottom: "6mm",
                    fontSize: "12pt",
                  }}
                >
                  <tbody>
                    <tr>
                      <td
                        style={{
                          width: "8mm",
                          fontWeight: 600,
                          verticalAlign: "top",
                          padding: 0,
                        }}
                      >
                        {index + 1}.
                      </td>
                      <td style={{ verticalAlign: "top", padding: 0 }}>
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
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontSize: "11pt",
                          color: "#444",
                          minWidth: "30mm",
                          verticalAlign: "top",
                          padding: 0,
                        }}
                      >
                        Date:{" "}
                        {rec.signed && rec.date
                          ? rec.date
                          : "___________"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              ))}
            </div>
          )}

          {/* ---- Copy to: (two-column table) ---- */}
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
