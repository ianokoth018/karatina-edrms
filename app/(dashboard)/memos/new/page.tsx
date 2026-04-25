"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import RichTextEditor from "@/components/memo/rich-text-editor";
import MemoPreview from "@/components/memo/memo-preview";
import MemoDocument from "@/components/memo/memo-document";
import { DepartmentUserSelect, type UserOption } from "@/components/shared/department-user-select";
import { DepartmentUserPicker } from "@/components/shared/department-user-picker";
import { MultiUserInput } from "@/components/shared/multi-user-input";
import { getDepartmentMemoCode, getDepartmentOffice } from "@/lib/departments";
import { isSenderMoreSenior } from "@/lib/role-hierarchy";

/* ========================================================================== */
/*  Constants                                                                 */
/* ========================================================================== */

const ADMIN_STEPS = [
  { num: 1, label: "Compose" },
  { num: 2, label: "Review & Generate" },
  { num: 3, label: "Recommenders & Approver" },
  { num: 4, label: "Submit" },
];

const COMMUNICATING_STEPS = [
  { num: 1, label: "Compose" },
  { num: 2, label: "Review & Generate" },
  { num: 3, label: "Submit" },
];

/* Department map is now centralised in lib/departments.ts */

/* Components DepartmentUserSelect, DepartmentUserPicker, MultiUserInput
   are imported from @/components/shared/ above */

/* ========================================================================== */
/*  Main component                                                            */
/* ========================================================================== */

export default function NewMemoPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const printRef = useRef<HTMLDivElement>(null);

  // ---------- Signature presence + URLs ----------
  // Probes /api/profile/signature/[me] once on mount so we can:
  //  (a) embed the signature in the preview before submission, and
  //  (b) prompt the user to upload one if missing.
  const [hasSignature, setHasSignature] = useState<boolean | null>(null);
  const [hasStamp, setHasStamp] = useState<boolean>(false);
  const senderSignatureUrl = session?.user?.id
    ? `/api/profile/signature/${session.user.id}?kind=signature`
    : undefined;
  const senderStampUrl = session?.user?.id
    ? `/api/profile/signature/${session.user.id}?kind=stamp`
    : undefined;

  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [sigRes, stampRes] = await Promise.all([
          fetch(`/api/profile/signature/${session.user.id}?kind=signature`, { method: "HEAD" }),
          fetch(`/api/profile/signature/${session.user.id}?kind=stamp`, { method: "HEAD" }),
        ]);
        if (cancelled) return;
        setHasSignature(sigRes.ok);
        setHasStamp(stampRes.ok);
      } catch {
        if (!cancelled) setHasSignature(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (status === "loading") return;
    const perms = session?.user?.permissions ?? [];
    if (!perms.includes("admin:manage") && !perms.includes("memos:create")) {
      router.replace("/memos");
    }
  }, [session, status, router]);

  const [memoType, setMemoType] = useState<"administrative" | "communicating">("administrative");
  const [memoCategory, setMemoCategory] = useState<"personal" | "departmental">("departmental");
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const STEPS = memoType === "communicating" ? COMMUNICATING_STEPS : ADMIN_STEPS;

  // Step 1: Compose
  const [toMode, setToMode] = useState<"search" | "manual">("search");
  const [recipient, setRecipient] = useState<UserOption | null>(null);
  const [manualTo, setManualTo] = useState("");
  const [ccUsers, setCcUsers] = useState<UserOption[]>([]);
  const [ccDepts, setCcDepts] = useState<string[]>([]);
  const [bccUsers, setBccUsers] = useState<UserOption[]>([]);
  const [bccDepts, setBccDepts] = useState<string[]>([]);
  const [department, setDepartment] = useState("");
  const [departmentOffice, setDepartmentOffice] = useState("");
  const [designation, setDesignation] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [subject, setSubject] = useState("");
  const [memoBody, setMemoBody] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentNames, setAttachmentNames] = useState<Record<number, string>>({});
  const [renamingIdx, setRenamingIdx] = useState<number | null>(null);
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string; type: string } | null>(null);

  // Step 2: Review & Generate
  const [memoGenerated, setMemoGenerated] = useState(false);
  const [showInSystemPreview, setShowInSystemPreview] = useState(false);
  // Signature method — picked on Step 2. "electronic" embeds the user's
  // saved signature image in the PDF; "digital" launches DocuSign signing
  // immediately after submit so the initiator cryptographically signs.
  const [signatureMethod, setSignatureMethod] = useState<"electronic" | "digital">("electronic");
  const [docusignAvailable, setDocusignAvailable] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/docusign/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setDocusignAvailable(Boolean(data?.enabled)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Step 3: Recommenders & Approver
  const [recommenders, setRecommenders] = useState<UserOption[]>([]);
  const [approverSameAsRecipient, setApproverSameAsRecipient] = useState(true);
  const [approver, setApprover] = useState<UserOption | null>(null);

  // ---------- Draft autosave ----------
  // Persist composer state to /api/memos/drafts so closing the tab,
  // logging out, or navigating away never loses work. The form rehydrates
  // from `?draft=<id>` on mount; subsequent edits debounce-save.
  // Note: file attachments aren't autosaved (Files API isn't serialisable);
  // the user re-attaches when resuming.
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const submittedRef = useRef(false);

  // Duplicate-memo warning — debounced check called as the user fills
  // in subject / reference number, so they're warned BEFORE preview
  // instead of getting "already exists" at submit time. Non-blocking
  // (the user can ignore and proceed if they really mean to).
  interface DuplicateMatch {
    id: string;
    subject: string;
    status: string;
    startedAt: string;
    referenceNumber: string;
  }
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[]>([]);

  // Pre-submit DocuSign signing — when the initiator picks Digital
  // signature on Step 2, they sign the draft *before* submitting. The
  // signed PDF is then attached to the memo on submit instead of the
  // server regenerating an unsigned one.
  const [draftDocusignStatus, setDraftDocusignStatus] = useState<string | null>(null);
  const [draftSignedAt, setDraftSignedAt] = useState<string | null>(null);
  const [draftHasSignedPdf, setDraftHasSignedPdf] = useState(false);
  const [isSigningDraft, setIsSigningDraft] = useState(false);
  const [draftSignError, setDraftSignError] = useState<string | null>(null);
  // Bumps every time the user signs a draft so the iframe preview
  // refetches the latest signed PDF instead of caching.
  const [signedPdfNonce, setSignedPdfNonce] = useState(0);
  // When the server has prepared a DocuSign envelope and is ready for
  // the user to sign, we hold the signing URL here and render an
  // explicit "Open in new tab" anchor. Anchor clicks bypass popup
  // blockers and avoid the popup-vs-DocuSign-cookies session conflict
  // that lands users on a logout page.
  const [draftSigningUrl, setDraftSigningUrl] = useState<string | null>(null);

  // HOD endorsement (preview step)
  const [forwardToHod, setForwardToHod] = useState(false);
  const [myHod, setMyHod] = useState<{ id: string; displayName: string; department: string | null } | null>(null);
  const userRoles = (session?.user?.roles as string[] | undefined) ?? [];
  const userIsHod = userRoles.includes("HOD");
  const showHodToggle =
    memoCategory === "departmental" &&
    memoType === "administrative" &&
    !userIsHod &&
    !!myHod;

  useEffect(() => {
    let cancelled = false;
    if (memoCategory === "departmental" && memoType === "administrative" && !userIsHod) {
      fetch("/api/users/my-hod")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => { if (!cancelled) setMyHod(data?.hod ?? null); })
        .catch(() => { if (!cancelled) setMyHod(null); });
    } else {
      setMyHod(null);
    }
    return () => { cancelled = true; };
  }, [memoCategory, memoType, userIsHod]);

  const finalApprover =
    approverSameAsRecipient && toMode === "search" ? recipient : approver;

  /** Determine if sender outranks recipient for FROM/TO ordering */
  const senderIsSuperior =
    toMode === "manual"
      ? true // Manual "To" (e.g., "All Students") — sender is always superior
      : isSenderMoreSenior(
          session?.user?.roles ?? [],
          recipient?.roles ?? []
        );

  /* ---------- auto-fill department & designation from session ---------- */
  useEffect(() => {
    if (session?.user?.department && !department) {
      const dept = session.user.department;
      setDepartment(dept);
      setDepartmentOffice(getDepartmentOffice(dept));
    }
    if (session?.user?.jobTitle && !designation) {
      setDesignation(session.user.jobTitle);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.department, session?.user?.jobTitle]);

  /* ---------- Draft hydration: load `?draft=<id>` on mount ---------- */
  useEffect(() => {
    if (status !== "authenticated") return;
    const queryDraftId = searchParams.get("draft");
    if (!queryDraftId) {
      setDraftHydrated(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/memos/drafts/${queryDraftId}`);
        if (!res.ok) {
          setDraftHydrated(true);
          return;
        }
        const draft = await res.json();
        if (cancelled) return;
        const p = (draft.payload ?? {}) as Record<string, unknown>;
        setDraftId(draft.id);
        if (typeof p.memoType === "string") setMemoType(p.memoType as "administrative" | "communicating");
        if (typeof p.memoCategory === "string") setMemoCategory(p.memoCategory as "personal" | "departmental");
        if (typeof p.toMode === "string") setToMode(p.toMode as "search" | "manual");
        if (p.recipient) setRecipient(p.recipient as UserOption);
        if (typeof p.manualTo === "string") setManualTo(p.manualTo);
        if (Array.isArray(p.ccUsers)) setCcUsers(p.ccUsers as UserOption[]);
        if (Array.isArray(p.ccDepts)) setCcDepts(p.ccDepts as string[]);
        if (Array.isArray(p.bccUsers)) setBccUsers(p.bccUsers as UserOption[]);
        if (Array.isArray(p.bccDepts)) setBccDepts(p.bccDepts as string[]);
        if (typeof p.department === "string") setDepartment(p.department);
        if (typeof p.departmentOffice === "string") setDepartmentOffice(p.departmentOffice);
        if (typeof p.designation === "string") setDesignation(p.designation);
        if (typeof p.referenceNumber === "string") setReferenceNumber(p.referenceNumber);
        if (typeof p.subject === "string") setSubject(p.subject);
        if (typeof p.memoBody === "string") setMemoBody(p.memoBody);
        if (Array.isArray(p.recommenders)) setRecommenders(p.recommenders as UserOption[]);
        if (typeof p.approverSameAsRecipient === "boolean")
          setApproverSameAsRecipient(p.approverSameAsRecipient);
        if (p.approver) setApprover(p.approver as UserOption);
        if (typeof p.forwardToHod === "boolean") setForwardToHod(p.forwardToHod);
        if (p.signatureMethod === "digital" || p.signatureMethod === "electronic") {
          setSignatureMethod(p.signatureMethod);
        }
        // Pre-sign state from server (set during draft DocuSign flow).
        setDraftDocusignStatus(draft.docusignStatus ?? null);
        setDraftSignedAt(draft.docusignSignedAt ?? null);
        setDraftHasSignedPdf(Boolean(draft.signedPdfPath));
        setDraftSavedAt(new Date(draft.updatedAt));
        setDraftStatus("saved");
      } catch {
        // swallow — composer just starts empty
      } finally {
        if (!cancelled) setDraftHydrated(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  /* ---------- Build the autosave payload ---------- */
  const buildDraftPayload = useCallback(() => {
    return {
      memoType,
      memoCategory,
      toMode,
      recipient,
      manualTo,
      ccUsers,
      ccDepts,
      bccUsers,
      bccDepts,
      department,
      departmentOffice,
      designation,
      referenceNumber,
      subject,
      memoBody,
      recommenders,
      approverSameAsRecipient,
      approver,
      forwardToHod,
      signatureMethod,
    };
  }, [
    memoType, memoCategory, toMode, recipient, manualTo,
    ccUsers, ccDepts, bccUsers, bccDepts,
    department, departmentOffice, designation,
    referenceNumber, subject, memoBody,
    recommenders, approverSameAsRecipient, approver, forwardToHod,
    signatureMethod,
  ]);

  /* ---------- Debounced autosave ---------- */
  useEffect(() => {
    if (!draftHydrated || status !== "authenticated") return;
    if (submittedRef.current) return;

    // Skip empty drafts — only start saving once the user has written
    // at least a subject or a body. Avoids littering the drafts list
    // every time someone clicks "New Memo" and bounces.
    const hasContent = subject.trim().length > 0 || memoBody.trim().length > 0;
    if (!hasContent && !draftId) return;

    const handle = setTimeout(async () => {
      const payload = buildDraftPayload();
      const subjectForList = subject.trim() || "Untitled draft";
      try {
        setDraftStatus("saving");
        if (!draftId) {
          const res = await fetch("/api/memos/drafts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject: subjectForList, payload }),
          });
          if (res.ok) {
            const created = await res.json();
            setDraftId(created.id);
            setDraftSavedAt(new Date(created.updatedAt));
            setDraftStatus("saved");
            // Reflect the draft id in the URL so a refresh keeps the
            // resume context without re-creating a fresh row.
            const url = new URL(window.location.href);
            url.searchParams.set("draft", created.id);
            window.history.replaceState(null, "", url.toString());
          } else {
            setDraftStatus("error");
          }
        } else {
          const res = await fetch(`/api/memos/drafts/${draftId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject: subjectForList, payload }),
          });
          if (res.ok) {
            const updated = await res.json();
            setDraftSavedAt(new Date(updated.updatedAt));
            setDraftStatus("saved");
            // The server may have invalidated a previous DocuSign
            // signature when the user edited the subject/body/recipient.
            // Mirror that locally so the composer re-prompts to sign.
            if (updated.signedPdfPath === null && draftHasSignedPdf) {
              setDraftHasSignedPdf(false);
              setDraftDocusignStatus(null);
              setDraftSignedAt(null);
              setDraftSigningUrl(null);
            }
          } else {
            setDraftStatus("error");
          }
        }
      } catch {
        setDraftStatus("error");
      }
    }, 1500);

    return () => clearTimeout(handle);
  }, [draftHydrated, status, draftId, subject, memoBody, buildDraftPayload]);

  /* ---------- Debounced duplicate check ---------- */
  useEffect(() => {
    const subjectClean = subject.trim();
    const refClean = referenceNumber.trim();
    if (subjectClean.length < 3 && refClean.length === 0) {
      setDuplicateMatches([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (subjectClean) params.set("subject", subjectClean);
        if (refClean) params.set("referenceNumber", refClean);
        const res = await fetch(`/api/memos/check-duplicate?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        setDuplicateMatches((data.matches as DuplicateMatch[]) ?? []);
      } catch {
        /* silent — non-blocking */
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [subject, referenceNumber]);

  /* ---------- Pre-submit DocuSign signing ---------- */

  /**
   * Capture the hidden MemoDocument as a PDF base64 string. Uses the
   * same html-to-image + pdf-lib pipeline the memo view's "Download
   * PDF" button uses, so the bytes we send to DocuSign are the bytes
   * the user already saw in the preview — no template divergence.
   * The element is briefly made visible off-screen for capture, then
   * restored.
   */
  async function captureDraftPdfBase64(): Promise<string | null> {
    const el = printRef.current;
    if (!el) return null;
    const wrapper = el.parentElement as HTMLElement;
    const prev = {
      display: wrapper.style.display,
      position: wrapper.style.position,
      left: wrapper.style.left,
      top: wrapper.style.top,
      visibility: wrapper.style.visibility,
    };
    wrapper.style.display = "block";
    wrapper.style.position = "absolute";
    wrapper.style.left = "-9999px";
    wrapper.style.top = "0";
    wrapper.style.visibility = "visible";

    let dataUrl: string;
    try {
      const { toPng } = await import("html-to-image");
      // cacheBust=false avoids 404s on signature endpoints that don't
      // accept arbitrary query params.
      dataUrl = await toPng(el, { pixelRatio: 2, cacheBust: false });
    } finally {
      Object.assign(wrapper.style, prev);
    }
    if (!dataUrl || !dataUrl.startsWith("data:image")) return null;

    const { PDFDocument } = await import("pdf-lib");
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const binary = atob(base64);
    const imgBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) imgBytes[i] = binary.charCodeAt(i);

    const pdfDoc = await PDFDocument.create();
    const img = await pdfDoc.embedPng(imgBytes);
    const pageW = 595.28;
    const pageH = 841.89;
    const imgAspect = img.height / img.width;
    const imgHeight = pageW * imgAspect;
    let numPages = Math.ceil(imgHeight / pageH);
    // MemoDocument has minHeight: 297mm which can cause a tiny overflow into
    // a second otherwise-empty page; trim if it's mostly whitespace.
    if (numPages > 1) {
      const lastPageContent = imgHeight - (numPages - 1) * pageH;
      if (lastPageContent < pageH * 0.1) numPages -= 1;
    }
    for (let i = 0; i < numPages; i++) {
      const page = pdfDoc.addPage([pageW, pageH]);
      page.drawImage(img, {
        x: 0,
        y: pageH - imgHeight + i * pageH,
        width: pageW,
        height: imgHeight,
      });
    }
    const pdfBytes = await pdfDoc.save();
    let bin = "";
    for (let i = 0; i < pdfBytes.length; i++) bin += String.fromCharCode(pdfBytes[i]);
    return btoa(bin);
  }

  /**
   * Force-flush the autosave so the server's draft.payload reflects what
   * the user just typed before we generate the PDF for signing. Returns
   * the draft id (creating one if necessary) so the caller can address
   * the per-draft sign endpoint.
   */
  async function ensureDraftSaved(): Promise<string | null> {
    const payload = buildDraftPayload();
    const subjectForList = subject.trim() || "Untitled draft";
    if (draftId) {
      const res = await fetch(`/api/memos/drafts/${draftId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subjectForList, payload }),
      });
      return res.ok ? draftId : null;
    }
    const res = await fetch("/api/memos/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: subjectForList, payload }),
    });
    if (!res.ok) return null;
    const created = await res.json();
    setDraftId(created.id);
    const url = new URL(window.location.href);
    url.searchParams.set("draft", created.id);
    window.history.replaceState(null, "", url.toString());
    return created.id;
  }

  /**
   * Step 1 of pre-sign: ensure the draft is saved server-side, generate
   * the memo PDF, create the DocuSign envelope, and stash the signing
   * URL in state. We deliberately do NOT auto-open a popup — popups get
   * blocked, fight DocuSign's session cookies, and land users on a
   * logout page. Instead we render an explicit anchor the user clicks.
   */
  async function handleSignDraftWithDocusign() {
    if (!canProceedStep1()) {
      setDraftSignError("Fill in subject, body and recipient before signing.");
      return;
    }
    setDraftSignError(null);
    setIsSigningDraft(true);
    setDraftSigningUrl(null);
    // Re-sign path: the server-side sign endpoint deletes the previous
    // signed PDF and clears envelope fields. Mirror that in local state
    // so the panel switches from the green "Signed" badge to the
    // "Open DocuSign signing" CTA, and the iframe collapses back to
    // the HTML preview while the new envelope is being prepared.
    setDraftHasSignedPdf(false);
    setDraftSignedAt(null);
    setDraftDocusignStatus(null);

    try {
      const id = await ensureDraftSaved();
      if (!id) {
        setIsSigningDraft(false);
        setDraftSignError("Couldn't save the draft before signing.");
        return;
      }

      // Capture the live MemoDocument as PDF so DocuSign signs the
      // exact same template the user previewed. Falls back gracefully
      // (server generates its own PDF) if the capture returns null.
      const pdfBase64 = await captureDraftPdfBase64();
      const res = await fetch(`/api/memos/drafts/${id}/docusign/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pdfBase64 ? { pdfBase64 } : {}),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        setDraftSignError(e?.error ?? "Failed to start DocuSign signing");
        setIsSigningDraft(false);
        return;
      }
      const data = (await res.json()) as { signingUrl?: string; envelopeId?: string };
      if (!data.signingUrl) {
        setDraftSignError("DocuSign returned no signing URL");
        setIsSigningDraft(false);
        return;
      }
      setDraftSigningUrl(data.signingUrl);
      setDraftDocusignStatus("sent");
    } catch {
      setDraftSignError("Network error launching DocuSign");
    } finally {
      setIsSigningDraft(false);
    }
  }

  async function refetchDraftSigningState(id: string) {
    try {
      const res = await fetch(`/api/memos/drafts/${id}`);
      if (!res.ok) return false;
      const draft = await res.json();
      setDraftDocusignStatus(draft.docusignStatus ?? null);
      setDraftSignedAt(draft.docusignSignedAt ?? null);
      const signed = Boolean(draft.signedPdfPath);
      setDraftHasSignedPdf(signed);
      if (signed) {
        setSignedPdfNonce((n) => n + 1);
        setDraftSigningUrl(null);
      }
      return signed;
    } catch {
      return false;
    }
  }

  /**
   * Background poll — once a signing URL is live and not yet signed,
   * check the draft every 4s to see if the DocuSign return endpoint
   * has filed the signed PDF. This is what lets the user sign in a
   * separate tab and come back to a fully-updated composer.
   */
  useEffect(() => {
    if (!draftId) return;
    if (!draftSigningUrl) return;
    if (draftHasSignedPdf) return;

    const handle = window.setInterval(() => {
      refetchDraftSigningState(draftId);
    }, 4000);
    return () => window.clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, draftSigningUrl, draftHasSignedPdf]);

  /* ---------- helpers ---------- */

  function formatDate(): string {
    const d = new Date();
    const day = d.getDate();
    const suffix =
      day === 1 || day === 21 || day === 31
        ? "st"
        : day === 2 || day === 22
        ? "nd"
        : day === 3 || day === 23
        ? "rd"
        : "th";
    const month = d.toLocaleDateString("en-US", { month: "long" });
    const year = d.getFullYear();
    return `${day}${suffix} ${month}, ${year}`;
  }

  function getInitials(name: string) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  /** Resolve the display text for the "To" field.
   *  - Manual mode: whatever the user typed (free text).
   *  - By-department mode: just the recipient's department/office name.
   *    Falls back to the displayName if the recipient record has no
   *    department on file. Memos read as office-to-office. */
  function getToDisplay(): string {
    if (toMode === "manual") return manualTo;
    if (recipient) {
      return recipient.department || recipient.displayName;
    }
    return "";
  }

  function canProceedStep1(): boolean {
    return missingStep1Fields().length === 0;
  }

  /** Returns the human-readable list of fields the user still needs to
   *  fill before they can proceed past Step 1. Used to render
   *  inline validation when they click Next while incomplete. */
  function missingStep1Fields(): string[] {
    const missing: string[] = [];
    const hasTo = toMode === "search" ? !!recipient : !!manualTo.trim();
    if (!hasTo) missing.push(toMode === "search" ? "To (Recipient)" : "To (typed name)");
    if (!subject.trim()) missing.push("Subject");
    if (!memoBody.trim()) missing.push("Memo Body");
    return missing;
  }

  // Validation message shown next to the Next button when the user
  // clicks while incomplete, instead of silently disabling.
  const [step1ValidationMsg, setStep1ValidationMsg] = useState<string | null>(null);

  function addRecommender(user: UserOption) {
    if (recommenders.length >= 5) return;
    if (recommenders.some((r) => r.id === user.id)) return;
    setRecommenders([...recommenders, user]);
  }

  function removeRecommender(index: number) {
    setRecommenders(recommenders.filter((_, i) => i !== index));
  }

  function moveRecommender(index: number, direction: "up" | "down") {
    const newList = [...recommenders];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newList.length) return;
    [newList[index], newList[targetIndex]] = [
      newList[targetIndex],
      newList[index],
    ];
    setRecommenders(newList);
  }

  function handleGenerateMemo() {
    setMemoGenerated(true);
  }

  function handleDownloadPdf() {
    window.print();
  }

  function handleDepartmentChange(dept: string) {
    setDepartment(dept);
    setDepartmentOffice(getDepartmentOffice(dept));
  }

  /** Preview of the auto-generated reference number */
  const refPreview = memoCategory === "personal"
    ? `KarU/PF.${(session?.user?.employeeId || "0000").replace(/\//g, ".")}/N`
    : `KarU/${getDepartmentMemoCode(department || "GEN")}/N`;

  const excludeIds = [
    session?.user?.id ?? "",
    recipient?.id ?? "",
    ...recommenders.map((r) => r.id),
    ...ccUsers.map((u) => u.id),
    ...bccUsers.map((u) => u.id),
  ].filter(Boolean);

  /* ---------- memo preview props ---------- */

  const memoPreviewProps = {
    universityName: "KARATINA UNIVERSITY",
    departmentOffice: departmentOffice || "OFFICE OF THE REGISTRAR",
    designation: designation || "",
    phone: "+254 0716135171/0723683150",
    poBox: "P.O Box 1957-10101,KARATINA",
    // FROM = the initiator's department/office (institutional context).
    // The signature block carries the personal name; FROM stays
    // organizational so memos read as office-to-office.
    from: departmentOffice || session?.user?.department || "",
    date: formatDate(),
    to: getToDisplay(),
    refNumber: referenceNumber || "---",
    subject,
    bodyHtml: memoBody,
    senderName: session?.user?.name ?? "",
    // Underlined line in the signature block is the *department* — same
    // identifier used in FROM. Designation lives in the user's profile
    // but the memo identifies the office that owns the communication.
    senderTitle: departmentOffice || session?.user?.department || "",
    // Embed the signature in the preview so the user sees what their
    // memo will look like once submitted. If they haven't uploaded one,
    // we render the dashed placeholder line and show a banner below.
    // When the initiator chose Digital signature, suppress the embedded
    // electronic signature in the preview — they'll sign with DocuSign
    // and the preview will swap to the signed PDF.
    senderSignatureUrl:
      signatureMethod === "digital"
        ? undefined
        : hasSignature
        ? senderSignatureUrl
        : undefined,
    senderStampUrl:
      signatureMethod === "digital"
        ? undefined
        : hasStamp
        ? senderStampUrl
        : undefined,
    senderIsSuperior,
    copyTo: ccUsers.map((u) => u.displayName),
    recommenders: recommenders.map((r) => ({
      name: r.displayName,
      title: [r.jobTitle, r.department].filter(Boolean).join(", "),
    })),
    approver: finalApprover
      ? {
          name: finalApprover.displayName,
          title: [finalApprover.jobTitle, finalApprover.department]
            .filter(Boolean)
            .join(", "),
        }
      : undefined,
    isDraft: true,
  };

  /* ---------- submit ---------- */

  async function handleSubmit() {
    const hasTo =
      toMode === "search" ? !!recipient : !!manualTo.trim();
    if (!hasTo || !subject.trim() || !memoBody.trim()) return;
    // Approval validation only for administrative memos
    if (memoType === "administrative" && toMode === "search" && !approverSameAsRecipient && !approver) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // Capture the live MemoDocument as PDF base64 so v1 is byte-
      // identical to what the user previewed — same template,
      // signature embedded if electronic. For digital this is
      // overwritten anyway by the signed PDF the server attaches.
      const initialPdfBase64 =
        signatureMethod === "electronic"
          ? await captureDraftPdfBase64()
          : null;

      const res = await fetch("/api/memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: toMode === "search" ? recipient!.id : manualTo.trim(),
          toIsManual: toMode === "manual",
          subject: subject.trim(),
          memoBody: memoBody.trim(),
          memoType,
          memoCategory,
          recommenders: memoType === "communicating" ? [] : recommenders.map((r) => r.id),
          approver: memoType === "communicating" ? undefined : finalApprover?.id,
          cc: ccUsers.map((u) => u.id),
          ccDepartments: ccDepts,
          bcc: bccUsers.map((u) => u.id),
          bccDepartments: bccDepts,
          department: department.trim(),
          departmentOffice: departmentOffice.trim(),
          designation: designation.trim(),
          referenceNumber: referenceNumber.trim() || undefined,
          forwardToHod: forwardToHod && showHodToggle,
          // When the user pre-signed digitally, send the draft id so the
          // server attaches the signed PDF as the memo's primary file.
          draftId:
            signatureMethod === "digital" && draftHasSignedPdf ? draftId : undefined,
          // Persist the chosen method so the memo view knows whether to
          // prompt for digital signing or treat the memo as already signed.
          signatureMethod,
          // Captured React MemoDocument bytes — used as v1 so Preview
          // Memo on the memo view shows the exact same template the
          // initiator approved at submission.
          initialPdfBase64: initialPdfBase64 ?? undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to create memo");
      }

      const data = await res.json();

      // Upload attachments to the linked document (if any)
      if (attachments.length > 0 && data.documentId) {
        for (let i = 0; i < attachments.length; i++) {
          const file = attachments[i];
          const customName = attachmentNames[i];
          const fileToUpload = customName
            ? new File([file], customName, { type: file.type })
            : file;
          const fileForm = new FormData();
          fileForm.append("file", fileToUpload);
          fileForm.append("documentId", data.documentId);
          await fetch("/api/files", {
            method: "POST",
            body: fileForm,
          }).catch(() => {}); // best effort — don't block memo creation
        }
      }

      // Memo persisted — discard the autosaved draft. We mark
      // submittedRef *before* the DELETE so the autosave effect can't
      // race in and re-create the row.
      submittedRef.current = true;
      if (draftId) {
        await fetch(`/api/memos/drafts/${draftId}`, { method: "DELETE" }).catch(() => {});
      }

      // Always go straight to the memo view. If the initiator chose
      // Digital and pre-signed, the signed PDF is attached server-side.
      // If they chose Digital and skipped signing, the memo view's
      // "Sign with DocuSign" panel lets them sign there — no auto-
      // launch, which used to race with draft state and reopen the
      // popup even when the user had already signed.
      router.push(`/memos/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsSubmitting(false);
    }
  }

  /* ======================================================================== */
  /*  Render                                                                  */
  /* ======================================================================== */

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* Hidden print document — same MemoDocument the user sees in the
          live preview, used as the source PDF for both the "Download as
          PDF" flow and (when Digital signature is selected) the PDF
          uploaded to DocuSign. Single template, no divergence. */}
      <div className="hidden print-only">
        <MemoDocument
          ref={printRef}
          {...memoPreviewProps}
          digitalSignatureMode={signatureMethod === "digital"}
        />
      </div>

      {/* Header */}
      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            New Internal Memo
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Compose, preview, and route an internal memorandum for approval
          </p>
        </div>
        {/* Draft autosave indicator */}
        {(draftId || draftStatus !== "idle") && (
          <div
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
              draftStatus === "error"
                ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
                : draftStatus === "saving"
                ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300"
                : "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300"
            }`}
            title={draftId ? `Draft id: ${draftId}` : ""}
          >
            {draftStatus === "saving" ? (
              <>
                <div className="w-3 h-3 border-2 border-amber-400/40 border-t-amber-700 rounded-full animate-spin" />
                Saving draft…
              </>
            ) : draftStatus === "error" ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                Save failed — will retry
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                Draft saved{draftSavedAt ? ` · ${draftSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
              </>
            )}
          </div>
        )}
      </div>

      {/* Step indicator */}
      <div className="no-print">
        <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto pb-1">
          {STEPS.map((s, idx) => (
            <div key={s.num} className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  if (s.num < step) setStep(s.num);
                }}
                disabled={s.num > step}
                className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all ${
                  s.num === step
                    ? "bg-[#02773b] text-white shadow-md shadow-[#02773b]/20"
                    : s.num < step
                    ? "bg-[#02773b]/10 text-[#02773b] dark:text-emerald-400 cursor-pointer hover:bg-[#02773b]/20"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                }`}
              >
                <span
                  className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    s.num === step
                      ? "bg-white/20 text-white"
                      : s.num < step
                      ? "bg-[#02773b] text-white"
                      : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                  }`}
                >
                  {s.num < step ? (
                    <svg
                      className="w-3 h-3 sm:w-3.5 sm:h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={3}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m4.5 12.75 6 6 9-13.5"
                      />
                    </svg>
                  ) : (
                    s.num
                  )}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {idx < STEPS.length - 1 && (
                <div
                  className={`w-4 sm:w-8 h-0.5 flex-shrink-0 ${
                    idx < step - 1
                      ? "bg-[#02773b]"
                      : "bg-gray-200 dark:bg-gray-700"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="no-print rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 text-red-500 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            </svg>
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-600 transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/*  STEP 1: Compose                                                    */}
      {/* ================================================================== */}
      {step === 1 && (
        <div className="no-print space-y-5 animate-slide-up">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 sm:p-6 space-y-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg
                className="w-5 h-5 text-[#02773b]"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                />
              </svg>
              Compose Memo
            </h2>

            {/* Memo Type Toggle */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Memo Type
              </label>
              <div className="inline-flex rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setMemoType("administrative")}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    memoType === "administrative"
                      ? "bg-[#02773b] text-white"
                      : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  Administrative
                </button>
                <button
                  type="button"
                  onClick={() => setMemoType("communicating")}
                  className={`px-4 py-2 text-sm font-medium border-l border-gray-200 dark:border-gray-700 transition-colors ${
                    memoType === "communicating"
                      ? "bg-[#02773b] text-white"
                      : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  Communicating
                </button>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                {memoType === "administrative"
                  ? "Requires recommenders and approval before circulation."
                  : "Sent directly — no approval chain needed."}
              </p>
            </div>

            {/* Memo Category Toggle */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Category
              </label>
              <div className="inline-flex rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setMemoCategory("departmental")}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    memoCategory === "departmental"
                      ? "bg-[#02773b] text-white"
                      : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  Departmental
                </button>
                <button
                  type="button"
                  onClick={() => setMemoCategory("personal")}
                  className={`px-4 py-2 text-sm font-medium border-l border-gray-200 dark:border-gray-700 transition-colors ${
                    memoCategory === "personal"
                      ? "bg-[#02773b] text-white"
                      : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  Personal
                </button>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                {memoCategory === "departmental"
                  ? "Department-level memo — reference uses department code."
                  : `Personal memo — reference uses your PF number (${session?.user?.employeeId || "---"}).`}
              </p>
            </div>

            {/* Row 1: Department, Office Title, Designation (all read-only) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Department
                </label>
                <input
                  type="text"
                  value={department}
                  placeholder="Auto-filled from your profile"
                  className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-not-allowed px-4 text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none"
                  disabled
                />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Auto-filled from your profile
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Office Title
                </label>
                <input
                  type="text"
                  value={departmentOffice}
                  placeholder="Auto-filled from department"
                  className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-not-allowed px-4 text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none"
                  disabled
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Designation
                </label>
                <input
                  type="text"
                  value={designation}
                  placeholder="Auto-filled from your profile"
                  className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-not-allowed px-4 text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none"
                  disabled
                />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Your job title / role
                </p>
              </div>
            </div>

            {/* Row 2: To (department-based) + Reference Number */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    To (Recipient) <span className="text-red-500" aria-label="required">*</span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setToMode("search");
                        setManualTo("");
                      }}
                      className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                        toMode === "search"
                          ? "bg-[#02773b] text-white"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                      }`}
                    >
                      By department
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setToMode("manual");
                        setRecipient(null);
                      }}
                      className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                        toMode === "manual"
                          ? "bg-[#02773b] text-white"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                      }`}
                    >
                      Type manually
                    </button>
                  </div>
                </div>

                {toMode === "search" ? (
                  <DepartmentUserSelect
                    onSelect={setRecipient}
                    excludeIds={[session?.user?.id ?? ""]}
                    selectedUser={recipient}
                    onClear={() => setRecipient(null)}
                  />
                ) : (
                  <input
                    type="text"
                    value={manualTo}
                    onChange={(e) => setManualTo(e.target.value)}
                    placeholder='e.g., "Current Students (2025/2026 AY)"'
                    className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-all focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Reference Number
                </label>
                <input
                  type="text"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  placeholder={`e.g., ${refPreview.replace("/N", "/1")}`}
                  className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-mono transition-all focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
                />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                  {referenceNumber
                    ? "Custom reference number will be used."
                    : `Auto-generated as ${refPreview}`}
                </p>
              </div>
            </div>

            {/* Row 3: CC and BCC */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <MultiUserInput
                  label="CC"
                  sublabel="(receives a copy for information)"
                  users={ccUsers}
                  departments={ccDepts}
                  onAdd={(user) => setCcUsers([...ccUsers, user])}
                  onRemove={(id) => setCcUsers(ccUsers.filter((u) => u.id !== id))}
                  onAddDepartment={(dept) => !ccDepts.includes(dept) && setCcDepts([...ccDepts, dept])}
                  onRemoveDepartment={(dept) => setCcDepts(ccDepts.filter((d) => d !== dept))}
                  excludeIds={excludeIds}
                  tagColor="blue"
                />
              </div>
              <div>
                <MultiUserInput
                  label="BCC"
                  sublabel="(hidden copy — not visible to others)"
                  users={bccUsers}
                  departments={bccDepts}
                  onAdd={(user) => setBccUsers([...bccUsers, user])}
                  onRemove={(id) => setBccUsers(bccUsers.filter((u) => u.id !== id))}
                  onAddDepartment={(dept) => !bccDepts.includes(dept) && setBccDepts([...bccDepts, dept])}
                  onRemoveDepartment={(dept) => setBccDepts(bccDepts.filter((d) => d !== dept))}
                  excludeIds={excludeIds}
                  tagColor="gray"
                />
              </div>
            </div>

            {/* Row 4: Subject (full width) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Subject <span className="text-red-500" aria-label="required">*</span>
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g., REMINDER ON FEE PAYMENT"
                className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-all focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
              />
              {duplicateMatches.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs">
                  <p className="font-medium text-amber-900 dark:text-amber-200">
                    Possible duplicate{duplicateMatches.length === 1 ? "" : "s"} —
                    you&apos;ve already created {duplicateMatches.length === 1 ? "a memo" : `${duplicateMatches.length} memos`} with this subject or reference:
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {duplicateMatches.map((m) => (
                      <li key={m.id}>
                        <Link
                          href={`/memos/${m.id}`}
                          target="_blank"
                          className="text-amber-800 dark:text-amber-300 hover:underline"
                        >
                          {m.referenceNumber} — {m.subject} ({m.status})
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                    You can still proceed if this is intentional.
                  </p>
                </div>
              )}
            </div>

            {/* Row 5: Memo Body (full width, taller editor) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Memo Body <span className="text-red-500" aria-label="required">*</span>
              </label>
              <div className="[&_.ProseMirror]:min-h-[400px]">
                <RichTextEditor
                  content={memoBody}
                  onChange={(html) => setMemoBody(html)}
                  placeholder="Type your memo content here..."
                />
              </div>
            </div>

            {/* Row 6: Attachments */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Attachments
              </label>
              <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-4 transition-colors hover:border-[#02773b]/40">
                <input
                  type="file"
                  multiple
                  onChange={(e) => {
                    if (e.target.files) {
                      setAttachments((prev) => [...prev, ...Array.from(e.target.files!)]);
                    }
                  }}
                  className="block w-full text-sm text-gray-500 dark:text-gray-400
                    file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0
                    file:text-sm file:font-medium file:bg-[#02773b]/10 file:text-[#02773b]
                    hover:file:bg-[#02773b]/20 file:cursor-pointer file:transition-colors"
                />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                  PDF, DOCX, XLSX, JPG, PNG — max 2GB per file
                </p>
              </div>

              {/* Attached files list */}
              {attachments.length > 0 && (
                <div className="mt-3 space-y-2">
                  {attachments.map((file, idx) => {
                    const displayName = attachmentNames[idx] || file.name;
                    const isRenaming = renamingIdx === idx;

                    return (
                      <div
                        key={`${file.name}-${idx}`}
                        className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 group"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                          </svg>
                          {isRenaming ? (
                            <input
                              type="text"
                              defaultValue={displayName}
                              autoFocus
                              onBlur={(e) => {
                                const newName = e.target.value.trim();
                                if (newName) {
                                  setAttachmentNames((prev) => ({ ...prev, [idx]: newName }));
                                }
                                setRenamingIdx(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const newName = (e.target as HTMLInputElement).value.trim();
                                  if (newName) {
                                    setAttachmentNames((prev) => ({ ...prev, [idx]: newName }));
                                  }
                                  setRenamingIdx(null);
                                }
                                if (e.key === "Escape") setRenamingIdx(null);
                              }}
                              className="flex-1 h-7 rounded border border-[#02773b] bg-white dark:bg-gray-900 px-2 text-sm text-gray-900 dark:text-gray-100 outline-none"
                            />
                          ) : (
                            <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{displayName}</span>
                          )}
                          <span className="text-xs text-gray-400 flex-shrink-0">
                            {file.size >= 1024 * 1024
                              ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                              : `${(file.size / 1024).toFixed(0)} KB`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                          {/* View */}
                          <button
                            onClick={() => {
                              const url = URL.createObjectURL(file);
                              setPreviewFile({ url, name: attachmentNames[idx] || file.name, type: file.type });
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-[#02773b] hover:bg-[#02773b]/10 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                            </svg>
                            <span className="hidden sm:inline">View</span>
                          </button>
                          {/* Rename */}
                          <button
                            onClick={() => setRenamingIdx(idx)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                            </svg>
                            <span className="hidden sm:inline">Rename</span>
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => {
                              setAttachments((prev) => prev.filter((_, i) => i !== idx));
                              setAttachmentNames((prev) => {
                                const next = { ...prev };
                                delete next[idx];
                                return next;
                              });
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                            <span className="hidden sm:inline">Delete</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Navigation */}
          <div className="flex justify-end">
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => {
                  const missing = missingStep1Fields();
                  if (missing.length > 0) {
                    setStep1ValidationMsg(
                      `Please fill in: ${missing.join(", ")}.`,
                    );
                    return;
                  }
                  setStep1ValidationMsg(null);
                  setMemoGenerated(false);
                  setShowInSystemPreview(false);
                  setStep(2);
                }}
                className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-[#02773b] text-white font-medium text-sm transition-all hover:bg-[#014d28] shadow-md shadow-[#02773b]/20 hover:shadow-lg hover:shadow-[#02773b]/30 focus:ring-2 focus:ring-[#02773b]/30 focus:ring-offset-2"
              >
                Next: Review &amp; Generate
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m8.25 4.5 7.5 7.5-7.5 7.5"
                  />
                </svg>
              </button>
              {step1ValidationMsg && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                  {step1ValidationMsg}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/*  STEP 2: Review & Generate                                          */}
      {/* ================================================================== */}
      {step === 2 && (
        <div className="no-print space-y-6 animate-slide-up">
          {/* Signature-missing prompt — only when we know they don't have one */}
          {hasSignature === false && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  No signature on file
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                  Your memo will be sent with a blank signature line under your
                  name. Upload your signature once via{" "}
                  <Link
                    href="/profile?tab=account"
                    className="font-semibold underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
                  >
                    Profile → Account → Signature &amp; Office Stamp
                  </Link>
                  {" "}so future memos carry it automatically.
                </p>
              </div>
            </div>
          )}

          {/* Signature method chooser — Electronic vs Digital. Determines
              what happens after submit: Electronic embeds the saved
              signature image in the PDF; Digital launches DocuSign for
              cryptographic signing in a popup. */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-5 sm:p-6">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Choose how to sign this memo
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Both options are legally valid. Digital signatures add a
                cryptographic certificate of completion via DocuSign.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSignatureMethod("electronic")}
                className={`text-left rounded-xl border-2 px-4 py-3 transition-all ${
                  signatureMethod === "electronic"
                    ? "border-[#02773b] bg-[#02773b]/5"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    signatureMethod === "electronic"
                      ? "border-[#02773b] bg-[#02773b]"
                      : "border-gray-300 dark:border-gray-600"
                  }`}>
                    {signatureMethod === "electronic" && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      Electronic signature
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                      Your saved signature image is embedded in the memo PDF.
                      Routed for approval immediately.
                    </p>
                  </div>
                </div>
              </button>
              <button
                type="button"
                disabled={!docusignAvailable}
                onClick={() => setSignatureMethod("digital")}
                title={!docusignAvailable ? "DocuSign integration is not configured. Ask an admin to enable it under Admin → DocuSign Integration." : ""}
                className={`text-left rounded-xl border-2 px-4 py-3 transition-all ${
                  !docusignAvailable
                    ? "border-gray-200 dark:border-gray-800 opacity-60 cursor-not-allowed"
                    : signatureMethod === "digital"
                    ? "border-[#02773b] bg-[#02773b]/5"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    signatureMethod === "digital" && docusignAvailable
                      ? "border-[#02773b] bg-[#02773b]"
                      : "border-gray-300 dark:border-gray-600"
                  }`}>
                    {signatureMethod === "digital" && docusignAvailable && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        Digital signature
                      </p>
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#02773b]/10 text-[#02773b] dark:text-emerald-400">
                        DocuSign
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                      {docusignAvailable
                        ? "Cryptographically sign via DocuSign in a popup. Signed PDF + certificate of completion auto-filed."
                        : "DocuSign integration is not configured. Ask an admin to enable it."}
                    </p>
                  </div>
                </div>
              </button>
            </div>

            {/* Digital signature CTA — only when Digital is the chosen
                method. Sign now → DocuSign popup → signed PDF replaces
                the preview below. */}
            {signatureMethod === "digital" && docusignAvailable && (
              <div className="mt-4 rounded-xl border border-[#02773b]/30 bg-[#02773b]/5 dark:bg-[#02773b]/10 p-4 flex flex-wrap items-center gap-3">
                {draftHasSignedPdf ? (
                  <>
                    <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                        Signed with DocuSign
                      </p>
                      <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-0.5">
                        {draftSignedAt ? `Signed ${new Date(draftSignedAt).toLocaleString()}` : "Signed PDF ready"}
                        {" · the preview below shows the cryptographically signed version with the certificate of completion."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSignDraftWithDocusign()}
                      disabled={isSigningDraft}
                      className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/30 disabled:opacity-50"
                    >
                      Re-sign
                    </button>
                  </>
                ) : draftSigningUrl ? (
                  <>
                    <div className="w-9 h-9 rounded-lg bg-[#02773b] flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        Ready to sign in DocuSign
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                        We&apos;ll keep this composer in sync — sign in the new tab,
                        then come back. The preview will swap to the signed PDF
                        automatically.
                      </p>
                    </div>
                    <a
                      href={draftSigningUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#015e2e]"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                      Open DocuSign signing
                    </a>
                    <button
                      type="button"
                      onClick={() => draftId && refetchDraftSigningState(draftId)}
                      className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
                      title="Manually check if the signing has completed"
                    >
                      I&apos;ve signed — check now
                    </button>
                  </>
                ) : (
                  <>
                    <div className="w-9 h-9 rounded-lg bg-[#02773b] flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        Sign this draft with DocuSign
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                        We prepare a DocuSign envelope, then open the signing
                        page in a new tab. Sign once and come back — no app
                        switching after that.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSignDraftWithDocusign()}
                      disabled={isSigningDraft}
                      className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#015e2e] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSigningDraft ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          Preparing envelope…
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                          </svg>
                          Prepare DocuSign signing
                        </>
                      )}
                    </button>
                  </>
                )}
                {draftSignError && (
                  <div className="basis-full text-xs text-red-700 dark:text-red-400 mt-1">
                    {draftSignError}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Preview card */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
            <div className="px-5 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-[#02773b]"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                    />
                  </svg>
                  Memo Preview
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Review the formatted memo before generating
                </p>
              </div>
              <button
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                  />
                </svg>
                Edit
              </button>
            </div>

            <div className="p-4 sm:p-8 bg-gray-100 dark:bg-gray-950">
              {signatureMethod === "digital" && draftHasSignedPdf && draftId ? (
                // Render the actual signed PDF (with cert of completion) so
                // the user sees what their submission will carry. Nonce
                // busts iframe cache after re-signing.
                <iframe
                  key={signedPdfNonce}
                  src={`/api/memos/drafts/${draftId}/signed-pdf?v=${signedPdfNonce}#view=FitH&zoom=page-width`}
                  className="w-full h-[70vh] sm:h-[80vh] bg-white border border-gray-200 dark:border-gray-800 rounded-xl"
                  title="DocuSign-signed memo preview"
                />
              ) : (
                <MemoPreview {...memoPreviewProps} />
              )}
            </div>
          </div>

          {/* Generate actions */}
          {!memoGenerated ? (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={handleGenerateMemo}
                className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-[#dd9f42] text-white font-medium text-sm transition-all hover:bg-[#c48a30] shadow-md shadow-[#dd9f42]/20 hover:shadow-lg"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
                  />
                </svg>
                Generate Memo
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Success indicator */}
              <div className="flex items-center justify-center gap-2 text-sm text-[#02773b] font-medium">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                  />
                </svg>
                Memo generated successfully
              </div>

              {/* Action buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  onClick={() => setShowInSystemPreview(true)}
                  className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border-2 border-[#02773b] text-[#02773b] dark:text-emerald-400 font-medium text-sm transition-all hover:bg-[#02773b]/5"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                    />
                  </svg>
                  Preview in System
                </button>
                <button
                  onClick={handleDownloadPdf}
                  className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border-2 border-[#dd9f42] text-[#dd9f42] font-medium text-sm transition-all hover:bg-[#dd9f42]/5"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                    />
                  </svg>
                  Download as PDF
                </button>
              </div>
            </div>
          )}

          {/* In-system preview modal */}
          {showInSystemPreview && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                {/* Modal header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Document Preview
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDownloadPdf}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#dd9f42]/10 text-[#dd9f42] hover:bg-[#dd9f42]/20 transition-colors"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                        />
                      </svg>
                      Download
                    </button>
                    <button
                      onClick={() => setShowInSystemPreview(false)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18 18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Modal body */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-100 dark:bg-gray-950">
                  <MemoDocument {...memoPreviewProps} />
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5 8.25 12l7.5-7.5"
                />
              </svg>
              Back: Compose
            </button>
            <button
              onClick={() => setStep(memoType === "communicating" ? 3 : 3)}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-[#02773b] text-white font-medium text-sm transition-all hover:bg-[#014d28] shadow-md shadow-[#02773b]/20 hover:shadow-lg hover:shadow-[#02773b]/30 focus:ring-2 focus:ring-[#02773b]/30 focus:ring-offset-2"
            >
              {memoType === "communicating" ? "Next: Submit" : "Next: Recommenders & Approver"}
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m8.25 4.5 7.5 7.5-7.5 7.5"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/*  STEP 3: Recommenders & Approver (administrative only)              */}
      {/* ================================================================== */}
      {step === 3 && memoType === "administrative" && (
        <div className="no-print space-y-6 animate-slide-up">
          {/* Recommenders card */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 sm:p-6 space-y-5 shadow-sm">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-[#dd9f42]"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
                  />
                </svg>
                Add Recommenders
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Optional. Add up to 5 people who must recommend (endorse) the
                memo before it reaches the final approver. They will review in
                the order listed.
              </p>
            </div>

            {/* Recommender list */}
            {recommenders.length > 0 && (
              <div className="space-y-2">
                {recommenders.map((rec, index) => (
                  <div
                    key={rec.id}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 group transition-colors hover:border-[#02773b]/30"
                  >
                    <span className="w-7 h-7 rounded-full bg-[#dd9f42]/10 text-[#dd9f42] flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {index + 1}
                    </span>
                    <div className="w-9 h-9 rounded-full bg-[#02773b] flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                      {getInitials(rec.displayName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {rec.displayName}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {[rec.jobTitle, rec.department]
                          .filter(Boolean)
                          .join(" - ") || rec.email}
                      </p>
                    </div>

                    {/* Reorder buttons */}
                    <div className="flex flex-col gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => moveRecommender(index, "up")}
                        disabled={index === 0}
                        className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Move up"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m4.5 15.75 7.5-7.5 7.5 7.5"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => moveRecommender(index, "down")}
                        disabled={index === recommenders.length - 1}
                        className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Move down"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m19.5 8.25-7.5 7.5-7.5-7.5"
                          />
                        </svg>
                      </button>
                    </div>

                    {/* Remove */}
                    <button
                      type="button"
                      onClick={() => removeRecommender(index)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      title="Remove"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18 18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add recommender */}
            {recommenders.length < 5 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Add Recommender
                </label>
                <DepartmentUserPicker
                  placeholder="Search department to add recommender..."
                  onSelect={addRecommender}
                  excludeIds={excludeIds}
                />
              </div>
            )}

            {recommenders.length >= 5 && (
              <p className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  />
                </svg>
                Maximum of 5 recommenders reached.
              </p>
            )}
          </div>

          {/* Approver card */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 sm:p-6 space-y-4 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg
                className="w-5 h-5 text-blue-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
                />
              </svg>
              Final Approver
            </h2>

            {toMode === "search" && recipient && (
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={approverSameAsRecipient}
                  onChange={(e) => {
                    setApproverSameAsRecipient(e.target.checked);
                    if (e.target.checked) setApprover(null);
                  }}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-[#02773b] focus:ring-[#02773b] accent-[#02773b]"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Approver is same as recipient
                  <span className="text-gray-400 ml-1">
                    ({recipient.displayName})
                  </span>
                </span>
              </label>
            )}

            {(toMode === "manual" || !approverSameAsRecipient) && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Select Approver
                </label>
                <DepartmentUserSelect
                  onSelect={setApprover}
                  excludeIds={[
                    session?.user?.id ?? "",
                    recipient?.id ?? "",
                    ...recommenders.map((r) => r.id),
                  ]}
                  selectedUser={approver}
                  onClear={() => setApprover(null)}
                />
              </div>
            )}
          </div>

          {/* Visual approval chain */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 sm:p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
              Approval Chain
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="px-3 py-1.5 rounded-full bg-[#02773b]/10 text-[#02773b] dark:text-emerald-400 font-medium border border-[#02773b]/20">
                You (Initiator)
              </span>
              {recommenders.map((rec, index) => (
                <span key={rec.id} className="contents">
                  <svg
                    className="w-4 h-4 text-gray-400 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m8.25 4.5 7.5 7.5-7.5 7.5"
                    />
                  </svg>
                  <span className="px-3 py-1.5 rounded-full bg-[#dd9f42]/10 text-[#dd9f42] font-medium border border-[#dd9f42]/20">
                    {rec.displayName} (R{index + 1})
                  </span>
                </span>
              ))}
              <svg
                className="w-4 h-4 text-gray-400 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m8.25 4.5 7.5 7.5-7.5 7.5"
                />
              </svg>
              <span className="px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 font-medium border border-blue-200 dark:border-blue-800">
                {finalApprover?.displayName ?? "Approver"} (Approver)
              </span>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex justify-between">
            <button
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5 8.25 12l7.5-7.5"
                />
              </svg>
              Back: Review
            </button>
            <button
              onClick={() => setStep(4)}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-[#02773b] text-white font-medium text-sm transition-all hover:bg-[#014d28] shadow-md shadow-[#02773b]/20 hover:shadow-lg hover:shadow-[#02773b]/30 focus:ring-2 focus:ring-[#02773b]/30 focus:ring-offset-2"
            >
              Next: Submit
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m8.25 4.5 7.5 7.5-7.5 7.5"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/*  STEP: Submit (step 4 for administrative, step 3 for communicating) */}
      {/* ================================================================== */}
      {((memoType === "administrative" && step === 4) ||
        (memoType === "communicating" && step === 3)) && (
        <div className="no-print space-y-6 animate-slide-up">
          {/* Summary card */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
            <div className="px-5 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-[#02773b]"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                  />
                </svg>
                Final Confirmation
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Review all details before sending the memo
              </p>
            </div>

            <div className="p-5 sm:p-6 space-y-4">
              {/* Summary rows */}
              <SummaryRow
                label="Type"
                value={`${memoType === "communicating" ? "Communicating" : "Administrative"} / ${memoCategory === "personal" ? "Personal" : "Departmental"}`}
              />
              <SummaryRow label="Department" value={department || "---"} />
              <SummaryRow label="To" value={getToDisplay() || "---"} />
              {(ccUsers.length > 0 || ccDepts.length > 0) && (
                <SummaryRow
                  label="CC"
                  value={[...ccDepts.map((d) => `[${d}]`), ...ccUsers.map((u) => u.displayName)].join(", ")}
                />
              )}
              {(bccUsers.length > 0 || bccDepts.length > 0) && (
                <SummaryRow
                  label="BCC"
                  value={[...bccDepts.map((d) => `[${d}]`), ...bccUsers.map((u) => u.displayName)].join(", ")}
                />
              )}
              <SummaryRow label="Subject" value={subject} bold />
              <SummaryRow
                label="Reference"
                value={referenceNumber || `Auto: ${refPreview}`}
                mono
              />
              {attachments.length > 0 && (
                <SummaryRow
                  label="Attachments"
                  value={`${attachments.length} file${attachments.length !== 1 ? "s" : ""} (${attachments.map((f) => f.name).join(", ")})`}
                />
              )}

              {memoType === "administrative" && (
                <>
                  {/* Divider */}
                  <hr className="border-gray-100 dark:border-gray-800" />

                  {/* Recommenders */}
                  {recommenders.length > 0 && (
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                        Recommenders
                      </span>
                      <div className="mt-2 space-y-1.5">
                        {recommenders.map((rec, index) => (
                          <div
                            key={rec.id}
                            className="flex items-center gap-2 text-sm"
                          >
                            <span className="w-5 h-5 rounded-full bg-[#dd9f42]/10 text-[#dd9f42] flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {index + 1}
                            </span>
                            <span className="text-gray-900 dark:text-gray-100">
                              {rec.displayName}
                            </span>
                            <span className="text-xs text-gray-400">
                              {rec.jobTitle}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {recommenders.length === 0 && (
                    <SummaryRow label="Recommenders" value="None" muted />
                  )}

                  {/* Approver */}
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                      Final Approver
                    </span>
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2.5}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m4.5 12.75 6 6 9-13.5"
                          />
                        </svg>
                      </span>
                      <span className="text-gray-900 dark:text-gray-100">
                        {finalApprover?.displayName ?? "Not set"}
                      </span>
                      <span className="text-xs text-gray-400">
                        {finalApprover?.jobTitle}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* HOD endorsement toggle (administrative + departmental only) */}
          {showHodToggle && myHod && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-[#02773b]/30 dark:border-[#02773b]/40 p-5 sm:p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <span className="w-8 h-8 rounded-full bg-[#02773b]/10 text-[#02773b] flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                      />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      Forward to {myHod.displayName}
                      {myHod.department ? ` (HOD, ${myHod.department})` : " (HOD)"}
                      {" "}for endorsement
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Your Head of Department will endorse the memo first. Once endorsed, the memo will bear the HOD's name before going to recommenders.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={forwardToHod}
                  onClick={() => setForwardToHod((v) => !v)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#02773b]/30 focus:ring-offset-2 ${
                    forwardToHod ? "bg-[#02773b]" : "bg-gray-200 dark:bg-gray-700"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      forwardToHod ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* Routing path (administrative) / Delivery info (communicating) */}
          {memoType === "administrative" ? (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 sm:p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Routing Path
              </h3>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="px-3 py-1.5 rounded-full bg-[#02773b]/10 text-[#02773b] dark:text-emerald-400 font-medium border border-[#02773b]/20">
                  You
                </span>
                {recommenders.map((rec) => (
                  <span key={rec.id} className="contents">
                    <svg
                      className="w-4 h-4 text-gray-400 flex-shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m8.25 4.5 7.5 7.5-7.5 7.5"
                      />
                    </svg>
                    <span className="px-3 py-1.5 rounded-full bg-[#dd9f42]/10 text-[#dd9f42] font-medium border border-[#dd9f42]/20">
                      {rec.displayName}
                    </span>
                  </span>
                ))}
                <svg
                  className="w-4 h-4 text-gray-400 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m8.25 4.5 7.5 7.5-7.5 7.5"
                  />
                </svg>
                <span className="px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 font-medium border border-blue-200 dark:border-blue-800">
                  {finalApprover?.displayName ?? "Approver"}
                </span>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 sm:p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Delivery
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                This memo will be sent directly to the recipient{ccUsers.length > 0 ? " and CC recipients" : ""} without an approval chain.
              </p>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between">
            <button
              onClick={() => setStep(memoType === "communicating" ? 2 : 3)}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5 8.25 12l7.5-7.5"
                />
              </svg>
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 h-11 px-7 rounded-xl bg-[#02773b] text-white font-semibold text-sm transition-all hover:bg-[#014d28] shadow-md shadow-[#02773b]/20 hover:shadow-lg hover:shadow-[#02773b]/30 focus:ring-2 focus:ring-[#02773b]/30 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
                    />
                  </svg>
                  Send Memo
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/*  Attachment Preview Modal                                         */}
      {/* ================================================================ */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { URL.revokeObjectURL(previewFile.url); setPreviewFile(null); }} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
              <div className="flex items-center gap-2 min-w-0">
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                </svg>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{previewFile.name}</span>
              </div>
              <button
                onClick={() => { URL.revokeObjectURL(previewFile.url); setPreviewFile(null); }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Content */}
            <div className="flex-1 overflow-auto p-1 bg-gray-100 dark:bg-gray-800">
              {previewFile.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewFile.url} alt={previewFile.name} className="max-w-full max-h-[75vh] mx-auto object-contain rounded" />
              ) : previewFile.type === "application/pdf" ? (
                <iframe src={`${previewFile.url}#view=FitH&zoom=page-width&toolbar=1&navpanes=0`} title={previewFile.name} className="w-full h-[75vh] rounded" />
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                  <svg className="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                  <p className="text-sm">Preview not available for this file type.</p>
                  <a href={previewFile.url} download={previewFile.name} className="mt-2 text-sm text-[#02773b] hover:underline">Download instead</a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  SummaryRow helper                                                         */
/* ========================================================================== */

function SummaryRow({
  label,
  value,
  bold,
  mono,
  muted,
}: {
  label: string;
  value: string;
  bold?: boolean;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-4">
      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 sm:w-24 flex-shrink-0">
        {label}
      </span>
      <span
        className={`text-sm ${
          muted
            ? "text-gray-400 dark:text-gray-500 italic"
            : "text-gray-900 dark:text-gray-100"
        } ${bold ? "font-semibold" : ""} ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
