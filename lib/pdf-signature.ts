import * as fs from "fs/promises";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString } from "pdf-lib";
import { logger } from "@/lib/logger";

export interface SignatureInfo {
  signerName: string | null;
  reason: string | null;
  location: string | null;
  contactInfo: string | null;
  signedAt: Date | null;
  isValid: boolean | null; // null = could not verify (no cert chain)
  fieldName: string;
  subFilter: string | null; // e.g., "adbe.pkcs7.detached"
  certificateSubject: string | null;
}

export interface SignatureVerificationResult {
  hasSig: boolean;
  signatures: SignatureInfo[];
  allValid: boolean | null; // null if any sig could not be verified
}

/**
 * Parse a PDF date string: D:YYYYMMDDHHmmSSOHH'mm'
 * Returns null if unparseable.
 */
function parsePdfDate(raw: string): Date | null {
  const cleaned = raw.replace(/^\(/, "").replace(/\)$/, "").replace(/^D:/, "");
  if (cleaned.length < 8) return null;
  const year = parseInt(cleaned.slice(0, 4), 10);
  const month = parseInt(cleaned.slice(4, 6), 10) - 1;
  const day = parseInt(cleaned.slice(6, 8), 10);
  const hour = cleaned.length >= 10 ? parseInt(cleaned.slice(8, 10), 10) : 0;
  const min = cleaned.length >= 12 ? parseInt(cleaned.slice(10, 12), 10) : 0;
  const sec = cleaned.length >= 14 ? parseInt(cleaned.slice(12, 14), 10) : 0;
  const d = new Date(Date.UTC(year, month, day, hour, min, sec));
  if (isNaN(d.getTime())) return null;
  return d;
}

/** Safely read a string value from a PDFDict key. Returns null if absent or wrong type. */
function dictString(dict: PDFDict, key: string): string | null {
  const val = dict.get(PDFName.of(key));
  if (!val) return null;
  if (val instanceof PDFString) return val.decodeText();
  if (val instanceof PDFHexString) return val.decodeText();
  // Fallback: try toString and strip PDF name slash
  const s = val.toString();
  if (s.startsWith("/")) return s.slice(1);
  return s || null;
}

/** Resolve a PDFRef to a PDFDict within the document, or return the value itself if already a dict. */
function resolveDict(
  doc: PDFDocument,
  val: ReturnType<PDFDict["get"]>
): PDFDict | null {
  if (!val) return null;
  if (val instanceof PDFDict) return val;
  if (val instanceof PDFRef) {
    const resolved = doc.context.lookup(val);
    if (resolved instanceof PDFDict) return resolved;
  }
  return null;
}

/**
 * Extract signature info from a single signature value dictionary.
 */
function extractSigInfo(
  doc: PDFDocument,
  fieldDict: PDFDict,
  fieldName: string
): SignatureInfo {
  // V entry points to the signature value dict
  const vRef = fieldDict.get(PDFName.of("V"));
  const vDict = resolveDict(doc, vRef);

  const info: SignatureInfo = {
    signerName: null,
    reason: null,
    location: null,
    contactInfo: null,
    signedAt: null,
    isValid: null,
    fieldName,
    subFilter: null,
    certificateSubject: null,
  };

  if (!vDict) return info;

  info.signerName = dictString(vDict, "Name");
  info.reason = dictString(vDict, "Reason");
  info.location = dictString(vDict, "Location");
  info.contactInfo = dictString(vDict, "ContactInfo");
  info.subFilter = dictString(vDict, "SubFilter");

  // Parse signing date /M
  const mVal = vDict.get(PDFName.of("M"));
  if (mVal) {
    const mRaw = mVal.toString();
    // Remove surrounding parentheses added by pdf-lib toString
    const stripped = mRaw.replace(/^\(/, "").replace(/\)$/, "");
    info.signedAt = parsePdfDate(stripped);
  }

  // Certificate subject: pdf-lib does not parse PKCS7 content,
  // so we leave certificateSubject null — full PKI verification
  // would require a separate ASN.1 parser.
  info.certificateSubject = null;
  info.isValid = null;

  return info;
}

/**
 * Fallback: scan raw PDF bytes for signature markers when pdf-lib
 * cannot traverse the AcroForm (e.g., certain encrypted files that
 * load despite ignoreEncryption).
 */
function rawByteSignatureCheck(buffer: Buffer): boolean {
  const raw = buffer.toString("latin1");
  return (
    raw.includes("/Type /Sig") ||
    raw.includes("/Type/Sig") ||
    raw.includes("/SubFilter /adbe.pkcs7") ||
    raw.includes("/SubFilter/adbe.pkcs7") ||
    raw.includes("/SubFilter /ETSI.CAdES") ||
    raw.includes("/SubFilter/ETSI.CAdES")
  );
}

/**
 * Detect and extract digital signature information from a PDF.
 * Does NOT cryptographically verify the signature (requires certificate chain).
 * Returns metadata about who signed, when, and with what sub-filter.
 */
export async function getSignatureInfo(
  pdfPath: string
): Promise<SignatureVerificationResult> {
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(pdfPath);
  } catch (err) {
    logger.error(
      "pdf-signature: could not read file",
      err instanceof Error ? err : undefined,
      { pdfPath }
    );
    return { hasSig: false, signatures: [], allValid: null };
  }

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch (err) {
    logger.error(
      "pdf-signature: pdf-lib failed to load document",
      err instanceof Error ? err : undefined,
      { pdfPath }
    );
    // Fallback: raw byte check only
    const hasSigRaw = rawByteSignatureCheck(buffer);
    return { hasSig: hasSigRaw, signatures: [], allValid: null };
  }

  const signatures: SignatureInfo[] = [];

  try {
    const catalog = pdfDoc.catalog;
    const acroFormRef = catalog.get(PDFName.of("AcroForm"));
    const acroForm = resolveDict(pdfDoc, acroFormRef);

    if (acroForm) {
      const fieldsVal = acroForm.get(PDFName.of("Fields"));

      let fieldRefs: Array<PDFRef | ReturnType<PDFDict["get"]>> = [];
      if (fieldsVal instanceof PDFArray) {
        fieldRefs = fieldsVal.asArray();
      }

      for (const fieldRef of fieldRefs) {
        const fieldDict = resolveDict(pdfDoc, fieldRef);
        if (!fieldDict) continue;

        // Check FT = /Sig
        const ftVal = fieldDict.get(PDFName.of("FT"));
        if (!ftVal) continue;
        const ftStr = ftVal.toString();
        if (ftStr !== "/Sig") continue;

        // Get field name /T
        const tVal = fieldDict.get(PDFName.of("T"));
        const fieldName = tVal
          ? tVal instanceof PDFString || tVal instanceof PDFHexString
            ? tVal.decodeText()
            : tVal.toString().replace(/^\(/, "").replace(/\)$/, "")
          : "(unknown)";

        const sigInfo = extractSigInfo(pdfDoc, fieldDict, fieldName);
        signatures.push(sigInfo);
      }
    }
  } catch (err) {
    logger.warn("pdf-signature: AcroForm traversal error", {
      pdfPath,
      err: String(err),
    });
  }

  // If pdf-lib traversal found nothing, try raw byte fallback
  const hasSig = signatures.length > 0 || rawByteSignatureCheck(buffer);

  // allValid: null because we cannot verify without a PKI chain
  const allValid: boolean | null = null;

  logger.info("pdf-signature: scan complete", {
    pdfPath,
    hasSig,
    sigCount: signatures.length,
  });

  return { hasSig, signatures, allValid };
}

/**
 * Check if a PDF has any digital signatures.
 */
export async function hasPdfSignatures(pdfPath: string): Promise<boolean> {
  const result = await getSignatureInfo(pdfPath);
  return result.hasSig;
}
