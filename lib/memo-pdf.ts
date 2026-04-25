import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import fs from "fs/promises";
import path from "path";

/**
 * Server-side memo PDF generation.
 *
 * Produces a clean A4 layout with:
 *  - KARU green header band + crest + university line
 *  - Memo metadata block (TO, FROM, REF, DATE, SUBJECT)
 *  - Body paragraphs (HTML stripped to plain text)
 *  - Signature block
 *  - Footer with copyright + page numbers
 *
 * Used by the circulation flow so recipients can receive the memo as a
 * PDF attachment in their inbox without having to log in.
 */

export interface MemoPdfData {
  memoReference: string;
  workflowReference?: string;
  subject: string;
  body: string;
  to: string;
  from: string;
  fromTitle?: string;
  fromDepartment?: string;
  cc?: string;
  date: string;
  approvedByName?: string;
  approvedByTitle?: string;
  approvedAt?: string;
  /** PNG/JPEG bytes of the *initiator's* signature — appears above their
   *  typed name in the From block (transparent background recommended). */
  signerSignaturePng?: Uint8Array;
  /** PNG/JPEG bytes of the *initiator's* office stamp/seal — overlays
   *  the signature like a real circular stamp. */
  signerStampPng?: Uint8Array;
  /** @deprecated Kept for backward compatibility — same as signerSignaturePng. */
  approverSignaturePng?: Uint8Array;
  /** @deprecated Kept for backward compatibility — same as signerStampPng. */
  approverStampPng?: Uint8Array;
  /** Phone number rendered in the letterhead's TEL: row. */
  phone?: string;
  /** PO Box / address rendered on the right of the letterhead row. */
  poBox?: string;
  /** Layout hint: when the sender outranks the recipient, FROM is shown
   *  before TO (matches Karatina memo convention). Defaults to true. */
  senderIsSuperior?: boolean;
  /** When true, the PDF is being prepared for DocuSign signing:
   *  - Drop the typed initiator name + designation (DocuSign's signature
   *    box already prints the signer's full name + email + envelope id).
   *  - Insert a hidden "/sn1/" anchor so DocuSign places its signature
   *    box at a deterministic spot.
   *  - Reserve extra vertical space below the anchor so the signature
   *    box and certificate strip don't collide with the department line. */
  digitalSignatureMode?: boolean;
}

const KARU_GREEN = rgb(0x02 / 255, 0x77 / 255, 0x3b / 255);
const KARU_GOLD = rgb(0xdd / 255, 0x9f / 255, 0x42 / 255);
const TEXT_DARK = rgb(0.12, 0.12, 0.13);
const TEXT_MUTED = rgb(0.42, 0.45, 0.5);
const BORDER = rgb(0.9, 0.91, 0.93);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 56;
// Tight header: KARU title at the top, divider line ~70pt down. Matches
// the React MemoPreview's compact letterhead — leaves more room for body.
const HEADER_H = 78;
const FOOTER_H = 0;
const BODY_TOP = HEADER_H + 18;
const BODY_BOTTOM = FOOTER_H + 24;

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    // One newline per paragraph break — the React MemoPreview renders
    // paragraphs back-to-back with no extra margin, so the PDF should
    // match. Two newlines here would create the blown-out paragraph
    // gaps we used to see in signed PDFs.
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/(div|h[1-6]|li)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "  • ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/\s+/);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const w = font.widthOfTextAtSize(candidate, size);
      if (w > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Helper for callers: read a user's signature / stamp bytes off disk so
 * they can be passed to generateMemoPdf. Returns null if the path is
 * missing or the file can't be read.
 */
export async function loadUserAssetPng(
  relativePath: string | null | undefined,
): Promise<Uint8Array | undefined> {
  if (!relativePath) return undefined;
  try {
    const normalised = path.normalize(relativePath);
    if (
      normalised.startsWith("..") ||
      path.isAbsolute(normalised) ||
      !normalised.startsWith(path.join("uploads", ""))
    ) {
      return undefined;
    }
    const buf = await fs.readFile(path.join(process.cwd(), normalised));
    return new Uint8Array(buf);
  } catch {
    return undefined;
  }
}

/**
 * Splits "OFFICE OF THE REGISTRAR (ACADEMIC AFFAIRS)" into a two-line
 * header — main + parenthetical sub. Mirrors the React MemoPreview
 * component so the on-screen preview and the PDF render the same way.
 */
function splitOfficeTitle(office: string): { main: string; sub?: string } {
  const m = office.match(/^([^(]+)\s*\((.*)\)\s*$/);
  if (m) return { main: m[1].trim(), sub: m[2].trim() };
  return { main: office };
}

function drawHeader(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  data: {
    fromDepartment?: string;
    phone?: string;
    poBox?: string;
  },
) {
  // Plain-white letterhead matching the React MemoPreview component:
  // no green band, no crest, just text + a solid divider underneath.
  // Compact spacing — title near the top, divider ~70pt down.

  // ---- KARATINA UNIVERSITY (centered, bold) ----
  const titleSize = 16;
  const title = "KARATINA UNIVERSITY";
  const titleW = fontBold.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: (PAGE_W - titleW) / 2,
    y: PAGE_H - 22,
    size: titleSize,
    font: fontBold,
    color: TEXT_DARK,
  });

  // ---- Office line (centered, bold) — main + optional sub ----
  const office = data.fromDepartment || "OFFICE OF THE REGISTRAR";
  const { main: officeMain, sub: officeSub } = splitOfficeTitle(office);
  const officeSize = 12;
  const officeW = fontBold.widthOfTextAtSize(officeMain, officeSize);
  page.drawText(officeMain, {
    x: (PAGE_W - officeW) / 2,
    y: PAGE_H - 38,
    size: officeSize,
    font: fontBold,
    color: TEXT_DARK,
  });
  if (officeSub) {
    const subW = fontBold.widthOfTextAtSize(officeSub, officeSize);
    page.drawText(officeSub, {
      x: (PAGE_W - subW) / 2,
      y: PAGE_H - 52,
      size: officeSize,
      font: fontBold,
      color: TEXT_DARK,
    });
  }

  // ---- TEL / P.O Box row (10pt, left/right) ----
  const rowY = PAGE_H - (officeSub ? 65 : 53);
  const phone = data.phone || "+254 0716135171/0723683150";
  const poBox = data.poBox || "P.O Box 1957-10101, KARATINA";
  page.drawText(`TEL: ${phone}`, {
    x: MARGIN_X,
    y: rowY,
    size: 10,
    font,
    color: TEXT_DARK,
  });
  const poW = font.widthOfTextAtSize(poBox, 10);
  page.drawText(poBox, {
    x: PAGE_W - MARGIN_X - poW,
    y: rowY,
    size: 10,
    font,
    color: TEXT_DARK,
  });

  // ---- Solid divider under the letterhead ----
  page.drawLine({
    start: { x: MARGIN_X, y: rowY - 6 },
    end: { x: PAGE_W - MARGIN_X, y: rowY - 6 },
    thickness: 1.5,
    color: TEXT_DARK,
  });
}

function drawFooter(
  page: PDFPage,
  font: PDFFont,
  pageNum: number,
  pageCount: number,
) {
  const year = new Date().getFullYear();
  const text = `© ${year} Karatina University · Generated by EDRMS`;
  const size = 8;
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: (PAGE_W - w) / 2,
    y: 18,
    size,
    font,
    color: TEXT_MUTED,
  });
  const pageLbl = `Page ${pageNum} of ${pageCount}`;
  const pageW = font.widthOfTextAtSize(pageLbl, size);
  page.drawText(pageLbl, {
    x: PAGE_W - MARGIN_X - pageW,
    y: 18,
    size,
    font,
    color: TEXT_MUTED,
  });
  // Top border line of footer
  page.drawLine({
    start: { x: MARGIN_X, y: 32 },
    end: { x: PAGE_W - MARGIN_X, y: 32 },
    thickness: 0.5,
    color: BORDER,
  });
}

export async function generateMemoPdf(data: MemoPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const headerData = {
    fromDepartment: data.fromDepartment,
    phone: data.phone,
    poBox: data.poBox,
  };

  const pages: PDFPage[] = [];
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  pages.push(page);

  drawHeader(page, font, fontBold, headerData);

  let cursorY = PAGE_H - BODY_TOP;
  const contentX = MARGIN_X;
  const contentWidth = PAGE_W - 2 * MARGIN_X;

  const writeLine = (
    text: string,
    f: PDFFont,
    size: number,
    color = TEXT_DARK,
  ) => {
    if (cursorY - size < BODY_BOTTOM) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      pages.push(page);
      drawHeader(page, font, fontBold, headerData);
      cursorY = PAGE_H - BODY_TOP;
    }
    page.drawText(text, { x: contentX, y: cursorY, size, font: f, color });
    cursorY -= size + 4;
  };

  const writeWrapped = (
    text: string,
    f: PDFFont,
    size: number,
    color = TEXT_DARK,
    leading = 1.5,
  ) => {
    const lines = wrapText(text, f, size, contentWidth);
    for (const ln of lines) {
      if (cursorY - size < BODY_BOTTOM) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        pages.push(page);
        drawHeader(page, font, fontBold, headerData);
        cursorY = PAGE_H - BODY_TOP;
      }
      page.drawText(ln, { x: contentX, y: cursorY, size, font: f, color });
      cursorY -= size * leading;
    }
  };

  // ----- "INTERNAL MEMO" centered title -----
  const memoTitleSize = 13;
  const memoTitleW = fontBold.widthOfTextAtSize("INTERNAL MEMO", memoTitleSize);
  page.drawText("INTERNAL MEMO", {
    x: (PAGE_W - memoTitleW) / 2,
    y: cursorY - memoTitleSize,
    size: memoTitleSize,
    font: fontBold,
    color: TEXT_DARK,
  });
  cursorY -= memoTitleSize + 14;

  // ----- FROM/TO with DATE/REF on the right (React MemoPreview parity) -----
  const senderIsSuperior = data.senderIsSuperior !== false;
  // Use the sender's name only — the React MemoPreview doesn't tack the
  // designation in parens after the name. Designation lives in the
  // signature block below the body, not in the FROM row.
  const fromValue = data.from;
  const rows: { label: string; value: string; rightLabel: string; rightValue: string }[] =
    senderIsSuperior
      ? [
          { label: "FROM:", value: fromValue, rightLabel: "DATE:", rightValue: data.date },
          { label: "TO:",   value: data.to,   rightLabel: "REF:",  rightValue: data.memoReference },
        ]
      : [
          { label: "TO:",   value: data.to,   rightLabel: "DATE:", rightValue: data.date },
          { label: "FROM:", value: fromValue, rightLabel: "REF:",  rightValue: data.memoReference },
        ];

  const rowFontSize = 11;
  const labelGap = 8;       // px between label and value on the left
  const rightColX = contentX + Math.floor(contentWidth * 0.6);
  const leftColMaxValueW = rightColX - contentX - 60; // leaves room for the FROM/TO label

  for (const row of rows) {
    const valueLines = wrapText(row.value, font, rowFontSize, leftColMaxValueW);
    const rowHeight = Math.max(16, valueLines.length * (rowFontSize + 3) + 4);
    if (cursorY - rowHeight < BODY_BOTTOM) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      pages.push(page);
      drawHeader(page, font, fontBold, headerData);
      cursorY = PAGE_H - BODY_TOP;
    }
    // Label (bold) + value
    const labelW = fontBold.widthOfTextAtSize(row.label, rowFontSize);
    page.drawText(row.label, {
      x: contentX,
      y: cursorY - rowFontSize,
      size: rowFontSize,
      font: fontBold,
      color: TEXT_DARK,
    });
    let valueY = cursorY - rowFontSize;
    for (const ln of valueLines) {
      page.drawText(ln, {
        x: contentX + labelW + labelGap,
        y: valueY,
        size: rowFontSize,
        font,
        color: TEXT_DARK,
      });
      valueY -= rowFontSize + 3;
    }
    // Right column: label + value on the same line as the first row line
    page.drawText(row.rightLabel, {
      x: rightColX,
      y: cursorY - rowFontSize,
      size: rowFontSize,
      font: fontBold,
      color: TEXT_DARK,
    });
    const rightLabelW = fontBold.widthOfTextAtSize(row.rightLabel, rowFontSize);
    page.drawText(row.rightValue, {
      x: rightColX + rightLabelW + 4,
      y: cursorY - rowFontSize,
      size: rowFontSize,
      font,
      color: TEXT_DARK,
    });

    cursorY -= rowHeight + 4;
  }

  // ----- RE: subject (bold, underlined) -----
  if (data.subject) {
    cursorY -= 6;
    const reSize = 11;
    page.drawText("RE: ", {
      x: contentX,
      y: cursorY - reSize,
      size: reSize,
      font: fontBold,
      color: TEXT_DARK,
    });
    const reLabelW = fontBold.widthOfTextAtSize("RE: ", reSize);
    const subjUpper = data.subject.toUpperCase();
    page.drawText(subjUpper, {
      x: contentX + reLabelW,
      y: cursorY - reSize,
      size: reSize,
      font: fontBold,
      color: TEXT_DARK,
    });
    const subjW = fontBold.widthOfTextAtSize(subjUpper, reSize);
    page.drawLine({
      start: { x: contentX + reLabelW, y: cursorY - reSize - 1.5 },
      end: { x: contentX + reLabelW + subjW, y: cursorY - reSize - 1.5 },
      thickness: 0.7,
      color: TEXT_DARK,
    });
    cursorY -= reSize + 14;
  }

  // ----- Body -----
  const bodyText = htmlToPlainText(data.body);
  writeWrapped(bodyText, font, 11, TEXT_DARK, 1.35);

  // ----- Signature block -----
  cursorY -= 24;
  writeLine("Yours faithfully,", font, 11);

  // For DocuSign-signed PDFs: drop a hidden "/sn1/" anchor exactly
  // where the user's electronic signature would have rendered, and
  // reserve enough vertical room for DocuSign's signature box + cert
  // strip so it doesn't collide with the typed name below. The rest
  // of the signature block (typed name, designation, department) is
  // unchanged — keeps the layout identical to the electronic preview.
  if (data.digitalSignatureMode) {
    const reservedHeight = 70;
    if (cursorY - reservedHeight < BODY_BOTTOM + 20) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      pages.push(page);
      drawHeader(page, font, fontBold, headerData);
      cursorY = PAGE_H - BODY_TOP;
    }
    // Invisible anchor — white-on-white, tiny font. DocuSign reads it
    // via signHereTabs.anchorString="/sn1/" and places its box here.
    page.drawText("/sn1/", {
      x: contentX,
      y: cursorY - 6,
      size: 6,
      font,
      color: rgb(1, 1, 1),
    });
    cursorY -= reservedHeight;
  }

  // Reserve space for the initiator's signature image (electronic mode
  // only — for digital we skip this and DocuSign paints the signature).
  const sigBytes = data.digitalSignatureMode
    ? undefined
    : (data.signerSignaturePng ?? data.approverSignaturePng);
  const stampBytes = data.digitalSignatureMode
    ? undefined
    : (data.signerStampPng ?? data.approverStampPng);

  if (sigBytes) {
    try {
      // Try PNG first then JPEG — PDFLib will throw if the format mismatches.
      let img;
      try {
        img = await pdf.embedPng(sigBytes);
      } catch {
        img = await pdf.embedJpg(sigBytes);
      }
      // Render at a fixed height (~36pt = 0.5 inch); width scales naturally.
      const sigH = 36;
      const sigW = Math.min(180, (img.width / img.height) * sigH);
      // If we're about to overflow into the footer, push to a new page first.
      if (cursorY - sigH < BODY_BOTTOM + 20) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        pages.push(page);
        drawHeader(page, font, fontBold, headerData);
        cursorY = PAGE_H - BODY_TOP;
      }
      page.drawImage(img, {
        x: contentX,
        y: cursorY - sigH,
        width: sigW,
        height: sigH,
      });

      // Office stamp/seal (if any) — overlay so it sits on top of the signature
      // the way real office stamps do on signed memos.
      if (stampBytes) {
        try {
          let stamp;
          try {
            stamp = await pdf.embedPng(stampBytes);
          } catch {
            stamp = await pdf.embedJpg(stampBytes);
          }
          const stampH = 64;
          const stampW = (stamp.width / stamp.height) * stampH;
          // Position to the right of the signature, slightly overlapping —
          // mimics the look in the sample memos.
          const stampX = contentX + sigW * 0.55;
          page.drawImage(stamp, {
            x: stampX,
            y: cursorY - stampH * 0.7,
            width: stampW,
            height: stampH,
            opacity: 0.85,
          });
        } catch {
          /* stamp embed failed — skip silently */
        }
      }

      cursorY -= sigH + 6;
    } catch {
      // Signature embed failed — fall back to whitespace
      cursorY -= 36;
    }
  } else {
    cursorY -= 28;
  }

  // Always render the typed signature block (name + designation +
  // department) regardless of signature method, so the digital and
  // electronic PDFs share an identical layout. For digital signatures
  // the DocuSign box sits in the reserved space *above* this block.
  writeLine(data.from.toUpperCase(), fontBold, 11);
  if (data.fromTitle) writeLine(data.fromTitle, font, 10, TEXT_MUTED);
  if (data.fromDepartment) writeLine(data.fromDepartment, font, 10, TEXT_MUTED);

  // ----- Approval acknowledgement strip (only if approver differs from author) -----
  if (data.approvedByName && data.approvedByName !== data.from) {
    cursorY -= 18;
    if (cursorY - 50 < BODY_BOTTOM) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      pages.push(page);
      drawHeader(page, font, fontBold, headerData);
      cursorY = PAGE_H - BODY_TOP;
    }
    page.drawRectangle({
      x: contentX,
      y: cursorY - 36,
      width: contentWidth,
      height: 44,
      color: rgb(0.96, 0.99, 0.96),
      borderColor: KARU_GREEN,
      borderWidth: 0.7,
    });
    page.drawText("APPROVED", {
      x: contentX + 12,
      y: cursorY - 14,
      size: 9,
      font: fontBold,
      color: KARU_GREEN,
    });
    page.drawText(data.approvedByName, {
      x: contentX + 12,
      y: cursorY - 26,
      size: 11,
      font: fontBold,
      color: TEXT_DARK,
    });
    if (data.approvedByTitle) {
      page.drawText(data.approvedByTitle, {
        x: contentX + 12,
        y: cursorY - 36,
        size: 9,
        font: fontItalic,
        color: TEXT_MUTED,
      });
    }
    if (data.approvedAt) {
      const lbl = `Approved on ${data.approvedAt}`;
      const lblW = font.widthOfTextAtSize(lbl, 9);
      page.drawText(lbl, {
        x: contentX + contentWidth - lblW - 12,
        y: cursorY - 14,
        size: 9,
        font,
        color: TEXT_MUTED,
      });
    }
    cursorY -= 50;
  }

  // ----- Footer on every page -----
  for (let i = 0; i < pages.length; i++) {
    drawFooter(pages[i], font, i + 1, pages.length);
  }

  return await pdf.save();
}
