"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";

/* ---------- constants ---------- */

const DOCUMENT_TYPES = [
  { value: "MEMO", label: "Memo" },
  { value: "LETTER", label: "Letter" },
  { value: "FORM", label: "Form" },
  { value: "REPORT", label: "Report" },
  { value: "STUDENT_FILE", label: "Student File" },
  { value: "CONTRACT", label: "Contract" },
  { value: "INVOICE", label: "Invoice" },
  { value: "POLICY", label: "Policy" },
  { value: "MEETING_MINUTES", label: "Meeting Minutes" },
  { value: "OTHER", label: "Other" },
] as const;

const ALLOWED_EXTENSIONS = ["pdf", "docx", "xlsx", "pptx", "jpg", "jpeg", "png", "tiff", "tif"];

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  tiff: "image/tiff",
  tif: "image/tiff",
};

interface MetadataField {
  key: string;
  value: string;
}

/* ---------- component ---------- */

export default function DocumentUploadPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* form state */
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [department, setDepartment] = useState(session?.user?.department ?? "");
  const [classificationNodeId, setClassificationNodeId] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [isVitalRecord, setIsVitalRecord] = useState(false);
  const [metadataFields, setMetadataFields] = useState<MetadataField[]>([]);

  /* upload state */
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  /* file validation */
  function validateFile(f: File): string | null {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `File type ".${ext}" is not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(", ")}`;
    }
    if (f.size > MAX_FILE_SIZE) {
      return "File size exceeds the 2 GB limit";
    }
    return null;
  }

  function handleFileSelect(f: File) {
    const err = validateFile(f);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setFile(f);
    // Auto-fill title from filename if empty
    if (!title) {
      const nameWithoutExt = f.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
      setTitle(nameWithoutExt);
    }
  }

  /* drag and drop handlers */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [title]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  }

  /* metadata field management */
  function addMetadataField() {
    setMetadataFields([...metadataFields, { key: "", value: "" }]);
  }

  function updateMetadataField(index: number, field: "key" | "value", val: string) {
    const updated = [...metadataFields];
    updated[index] = { ...updated[index], [field]: val };
    setMetadataFields(updated);
  }

  function removeMetadataField(index: number) {
    setMetadataFields(metadataFields.filter((_, i) => i !== index));
  }

  /* submit */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!file) {
      setError("Please select a file to upload");
      return;
    }

    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    if (!documentType) {
      setError("Please select a document type");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title.trim());
      formData.append("documentType", documentType);
      formData.append("department", department || session?.user?.department || "GENERAL");
      formData.append("description", description);
      formData.append("tags", tagsInput);
      formData.append("isVitalRecord", String(isVitalRecord));

      if (classificationNodeId) {
        formData.append("classificationNodeId", classificationNodeId);
      }

      // Build metadata object from key-value fields
      const metadataObj: Record<string, string> = {};
      for (const { key, value } of metadataFields) {
        if (key.trim() && value.trim()) {
          metadataObj[key.trim()] = value.trim();
        }
      }
      if (Object.keys(metadataObj).length > 0) {
        formData.append("metadata", JSON.stringify(metadataObj));
      }

      // Simulate progress for UX (real progress requires XMLHttpRequest)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + Math.random() * 15;
        });
      }, 200);

      const res = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });

      clearInterval(progressInterval);

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Upload failed");
      }

      const document = await res.json();
      setUploadProgress(100);

      // Brief pause to show completion
      setTimeout(() => {
        router.push(`/documents/${document.id}`);
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setUploadProgress(0);
      setIsUploading(false);
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getFileIcon(fileName: string) {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pdf") return "text-red-500";
    if (["doc", "docx"].includes(ext)) return "text-blue-500";
    if (["xls", "xlsx"].includes(ext)) return "text-green-600";
    if (["ppt", "pptx"].includes(ext)) return "text-orange-500";
    if (["jpg", "jpeg", "png", "tiff", "tif"].includes(ext)) return "text-purple-500";
    return "text-gray-500";
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/documents"
          className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Upload Document</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Add a new document to the EDRMS</p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 animate-slide-up">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Upload progress bar */}
        {isUploading && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 animate-slide-up">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {uploadProgress >= 100 ? "Upload complete" : "Uploading..."}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {Math.round(uploadProgress)}%
              </span>
            </div>
            <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-karu-green rounded-full transition-all duration-300 ease-out"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* File drop zone */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 animate-slide-up delay-100">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">File</h2>

          {file ? (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
              <div className={`flex-shrink-0 ${getFileIcon(file.name)}`}>
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{file.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <div
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                isDragging
                  ? "border-karu-green bg-karu-green-light dark:bg-karu-green/5"
                  : "border-gray-300 dark:border-gray-600 hover:border-karu-green hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              <svg className="mx-auto w-10 h-10 text-gray-400 dark:text-gray-500 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                <span className="text-karu-green font-medium">Click to browse</span> or drag and drop
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                PDF, DOCX, XLSX, PPTX, JPG, PNG, TIFF &mdash; Max 2 GB
              </p>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileInputChange}
            accept={ALLOWED_EXTENSIONS.map((e) => MIME_MAP[e] || `.${e}`).join(",")}
            className="hidden"
          />
        </div>

        {/* Document details */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-5 animate-slide-up delay-200">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Document Details</h2>

          {/* Title */}
          <div className="space-y-1.5">
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter document title"
              required
              className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
            />
          </div>

          {/* Document type */}
          <div className="space-y-1.5">
            <label htmlFor="documentType" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              Document Type <span className="text-red-500">*</span>
            </label>
            <select
              id="documentType"
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              required
              className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
            >
              <option value="">Select type...</option>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Department */}
          <div className="space-y-1.5">
            <label htmlFor="department" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              Department
            </label>
            <input
              id="department"
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. ICT, Finance, Admissions"
              className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
            />
          </div>

          {/* Classification node */}
          <div className="space-y-1.5">
            <label htmlFor="classificationNodeId" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              Classification Node <span className="text-xs text-gray-400">(optional)</span>
            </label>
            <input
              id="classificationNodeId"
              type="text"
              value={classificationNodeId}
              onChange={(e) => setClassificationNodeId(e.target.value)}
              placeholder="Enter classification node ID"
              className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this document"
              rows={3}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none resize-none"
            />
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <label htmlFor="tags" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              Tags
            </label>
            <input
              id="tags"
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="Enter tags separated by commas (e.g. finance, urgent, 2026)"
              className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
            />
            {tagsInput && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {tagsInput.split(",").map((tag, i) => {
                  const trimmed = tag.trim();
                  if (!trimmed) return null;
                  return (
                    <span
                      key={i}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-karu-green-light text-karu-green dark:bg-karu-green/10"
                    >
                      {trimmed}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Vital record */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isVitalRecord}
              onChange={(e) => setIsVitalRecord(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-karu-green focus:ring-karu-green/20"
            />
            <div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Mark as Vital Record</span>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Vital records receive special preservation and backup treatment
              </p>
            </div>
          </label>
        </div>

        {/* Dynamic metadata fields */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4 animate-slide-up delay-300">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Additional Metadata <span className="text-xs font-normal text-gray-400">(optional)</span>
            </h2>
            <button
              type="button"
              onClick={addMetadataField}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-karu-green hover:bg-karu-green-light dark:hover:bg-karu-green/10 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Field
            </button>
          </div>

          {metadataFields.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              No custom metadata fields added. Click &quot;Add Field&quot; to add key-value pairs.
            </p>
          ) : (
            <div className="space-y-2">
              {metadataFields.map((field, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={field.key}
                    onChange={(e) => updateMetadataField(index, "key", e.target.value)}
                    placeholder="Key"
                    className="flex-1 h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20"
                  />
                  <input
                    type="text"
                    value={field.value}
                    onChange={(e) => updateMetadataField(index, "value", e.target.value)}
                    placeholder="Value"
                    className="flex-1 h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20"
                  />
                  <button
                    type="button"
                    onClick={() => removeMetadataField(index)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors flex-shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submit buttons */}
        <div className="flex items-center justify-end gap-3 animate-slide-up delay-500">
          <Link
            href="/documents"
            className="h-10 px-5 inline-flex items-center rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isUploading || !file}
            className="h-10 px-6 inline-flex items-center gap-2 rounded-xl bg-karu-green text-white text-sm font-medium transition-all hover:bg-karu-green-dark focus:ring-2 focus:ring-karu-green/20 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Uploading...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
                Upload Document
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
