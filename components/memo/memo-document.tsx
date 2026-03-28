"use client";

import { forwardRef } from "react";
import type { MemoPreviewProps } from "./memo-preview";

/**
 * Printable / downloadable memo document.
 *
 * Renders the memo in an A4-friendly layout with @media print styles.
 * Use this inside a hidden div or dialog, then call window.print()
 * with a print-specific stylesheet targeting this component.
 */
const MemoDocument = forwardRef<HTMLDivElement, MemoPreviewProps>(
  function MemoDocument(
    {
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
    },
    ref
  ) {
    return (
      <div
        ref={ref}
        className="memo-print-document bg-white text-black"
        style={{
          width: "210mm",
          minHeight: "297mm",
          margin: "0 auto",
          padding: "0",
          fontFamily: "'Times New Roman', Times, serif",
          fontSize: "12pt",
          lineHeight: "1.5",
          position: "relative",
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
        <div style={{ position: "relative", zIndex: 2, padding: "15mm 20mm" }}>
          {/* University header */}
          <div style={{ textAlign: "center", marginBottom: "8mm" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={{ textAlign: "center", paddingBottom: "4mm" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/karu-crest.png"
                      alt="Karatina University Crest"
                      style={{ height: "50px", display: "inline-block" }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <div
                      style={{
                        fontSize: "18pt",
                        fontWeight: "bold",
                        letterSpacing: "3px",
                        textTransform: "uppercase",
                        marginTop: "2mm",
                      }}
                    >
                      KARATINA UNIVERSITY
                    </div>
                    <div
                      style={{
                        width: "80px",
                        height: "2px",
                        background: "#dd9f42",
                        margin: "3mm auto",
                      }}
                    />
                    <div
                      style={{
                        fontSize: "12pt",
                        fontWeight: 600,
                        letterSpacing: "4px",
                        textTransform: "uppercase",
                        color: "#333",
                      }}
                    >
                      INTERNAL MEMORANDUM
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <hr
              style={{
                border: "none",
                borderTop: "2px solid #02773b",
                marginTop: "4mm",
              }}
            />
          </div>

          {/* Reference and date */}
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginBottom: "4mm",
            }}
          >
            <tbody>
              <tr>
                <td style={{ fontSize: "11pt" }}>
                  <strong>REF:</strong>{" "}
                  <span style={{ fontFamily: "monospace" }}>
                    {referenceNumber || "---"}
                  </span>
                </td>
                <td style={{ textAlign: "right", fontSize: "11pt" }}>
                  <strong>DATE:</strong> {date}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Addressing block */}
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginBottom: "4mm",
              fontSize: "11pt",
            }}
          >
            <tbody>
              <tr>
                <td style={{ width: "80px", fontWeight: "bold", padding: "2mm 0", verticalAlign: "top" }}>TO:</td>
                <td style={{ padding: "2mm 0" }}>
                  {to.name}
                  {to.title && `, ${to.title}`}
                </td>
              </tr>
              {cc && cc.length > 0 && (
                <tr>
                  <td style={{ fontWeight: "bold", padding: "2mm 0", verticalAlign: "top" }}>CC:</td>
                  <td style={{ padding: "2mm 0" }}>
                    {cc
                      .map((u) => `${u.name}${u.title ? `, ${u.title}` : ""}`)
                      .join("; ")}
                  </td>
                </tr>
              )}
              <tr>
                <td style={{ fontWeight: "bold", padding: "2mm 0", verticalAlign: "top" }}>FROM:</td>
                <td style={{ padding: "2mm 0" }}>
                  {from.name}
                  {from.title && `, ${from.title}`}
                </td>
              </tr>
              <tr>
                <td style={{ fontWeight: "bold", padding: "2mm 0", verticalAlign: "top" }}>SUBJECT:</td>
                <td style={{ padding: "2mm 0", fontWeight: "bold" }}>
                  {subject}
                </td>
              </tr>
            </tbody>
          </table>

          <hr style={{ border: "none", borderTop: "1px solid #ccc", margin: "4mm 0" }} />

          {/* Body */}
          <div
            style={{
              fontSize: "11pt",
              lineHeight: "1.6",
              minHeight: "80mm",
              marginBottom: "6mm",
            }}
            dangerouslySetInnerHTML={{ __html: body }}
          />

          <hr style={{ border: "none", borderTop: "1px solid #ccc", margin: "4mm 0" }} />

          {/* Recommenders */}
          {recommenders && recommenders.length > 0 && (
            <div style={{ marginTop: "6mm", marginBottom: "6mm" }}>
              <p style={{ fontWeight: "bold", fontSize: "11pt", marginBottom: "4mm", letterSpacing: "1px" }}>
                RECOMMENDED BY:
              </p>
              {recommenders.map((rec, index) => (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: "10mm",
                    marginBottom: "6mm",
                    fontSize: "11pt",
                  }}
                >
                  <span style={{ width: "8mm", fontWeight: 600, textAlign: "right" }}>
                    {index + 1}.
                  </span>
                  <div style={{ flex: 1 }}>
                    {rec.signed ? (
                      <div style={{ color: "#02773b", fontStyle: "italic", marginBottom: "1mm" }}>
                        Signed{rec.signedAt ? ` on ${rec.signedAt}` : ""}
                      </div>
                    ) : (
                      <div
                        style={{
                          borderBottom: "1px dashed #999",
                          minWidth: "60mm",
                          height: "8mm",
                          marginBottom: "1mm",
                        }}
                      />
                    )}
                    <div style={{ fontSize: "9pt", color: "#666" }}>
                      {rec.name}
                      {rec.title && `, ${rec.title}`}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: "9pt", color: "#888", minWidth: "35mm" }}>
                    Date: {rec.signed && rec.signedAt ? rec.signedAt : "___________"}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Approver */}
          {approver && (
            <div style={{ marginTop: "6mm", marginBottom: "6mm" }}>
              <p style={{ fontWeight: "bold", fontSize: "11pt", marginBottom: "4mm", letterSpacing: "1px" }}>
                APPROVED BY:
              </p>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: "10mm",
                  fontSize: "11pt",
                }}
              >
                <div style={{ flex: 1 }}>
                  {approver.signed ? (
                    <div style={{ color: "#02773b", fontStyle: "italic", marginBottom: "1mm" }}>
                      Signed{approver.signedAt ? ` on ${approver.signedAt}` : ""}
                    </div>
                  ) : (
                    <div
                      style={{
                        borderBottom: "1px dashed #999",
                        minWidth: "60mm",
                        height: "8mm",
                        marginBottom: "1mm",
                      }}
                    />
                  )}
                  <div style={{ fontSize: "9pt", color: "#666" }}>
                    {approver.name}
                    {approver.title && `, ${approver.title}`}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: "9pt", color: "#888", minWidth: "35mm" }}>
                  Date: {approver.signed && approver.signedAt ? approver.signedAt : "___________"}
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{ marginTop: "10mm" }}>
            <hr style={{ border: "none", borderTop: "2px solid #02773b" }} />
            <p
              style={{
                textAlign: "center",
                fontSize: "9pt",
                color: "#666",
                marginTop: "3mm",
                letterSpacing: "1px",
              }}
            >
              Karatina University &bull; P.O. Box 1957-10101, Karatina, Kenya
            </p>
          </div>
        </div>
      </div>
    );
  }
);

export default MemoDocument;
