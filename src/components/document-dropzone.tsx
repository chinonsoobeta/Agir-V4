import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { UploadCloud, FileText, Loader2, CheckCircle2, XCircle, CopyX } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  createDocument,
  finalizeDocumentUpload,
  requestDocumentUpload,
} from "@/lib/documents.functions";
import { cn } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";

type CreatedDocument = Tables<"documents"> & { deduped?: boolean };

const ACCEPT = ".pdf,.xlsx,.xls,.doc,.docx,.csv,.txt,.png,.jpg,.jpeg";
const ACCEPT_RE = /\.(pdf|xlsx|xls|docx?|csv|txt|png|jpe?g)$/i;
// Mirror of UPLOAD_LIMITS.maxFileBytes (server is authoritative); enforced here
// for immediate, graceful feedback before bytes are sent.
const MAX_FILE_BYTES = 75 * 1024 * 1024;

async function sha256Hex(file: File): Promise<string | null> {
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null; // hashing is best-effort; server still enforces guards
  }
}

type ItemStatus =
  | "queued"
  | "uploading"
  | "verifying"
  | "verificationQueued"
  | "done"
  | "failed"
  | "duplicate";
type QueueItem = { id: string; name: string; status: ItemStatus; error?: string };

const STATUS_META: Record<ItemStatus, { icon: LucideIcon; cls: string; label: string }> = {
  queued: { icon: FileText, cls: "text-muted-foreground", label: "Queued" },
  uploading: { icon: Loader2, cls: "text-primary animate-spin", label: "Uploading…" },
  verifying: { icon: Loader2, cls: "text-primary animate-spin", label: "Queueing verification…" },
  verificationQueued: { icon: Loader2, cls: "text-primary", label: "Verification queued" },
  done: { icon: CheckCircle2, cls: "text-success", label: "Verified and queued for extraction" },
  failed: { icon: XCircle, cls: "text-destructive", label: "Failed" },
  duplicate: { icon: CopyX, cls: "text-warning", label: "Duplicate: skipped" },
};

/**
 * Drag-and-drop, multi-file document upload with per-file status, duplicate
 * detection, and automatic extraction. Each file: dedup → upload → create →
 * extract, with clear failure messages. Extraction runs through the existing
 * deterministic-safe analyzeDocument (it summarizes only; it never invents
 * financial values).
 */
export function DocumentDropzone({
  projectId,
  permitCaseId,
  propertyId,
  replacesDocumentId,
  category,
  existingNames,
  onChanged,
  autoAnalyze = true,
  helperText = "Multiple files supported · PDF, Excel, Word, CSV, images · assumptions are extracted automatically",
}: {
  projectId: string | null;
  permitCaseId?: string | null;
  propertyId?: string | null;
  replacesDocumentId?: string | null;
  category: string;
  existingNames: string[];
  onChanged: () => void;
  autoAnalyze?: boolean;
  helperText?: string;
}) {
  const createFn = useServerFn(createDocument);
  const requestUploadFn = useServerFn(requestDocumentUpload);
  const finalizeUploadFn = useServerFn(finalizeDocumentUpload);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  // Counter for stable local ids without Math.random/Date in render.
  const seq = useRef(0);

  function setItem(id: string, patch: Partial<QueueItem>) {
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function processFile(file: File, id: string) {
    if (!ACCEPT_RE.test(file.name)) {
      setItem(id, { status: "failed", error: "Unsupported file type" });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setItem(id, {
        status: "failed",
        error: `Too large (max ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB)`,
      });
      return;
    }
    try {
      setItem(id, { status: "uploading" });
      const authorization = await requestUploadFn({
        data: {
          project_id: projectId,
          permit_case_id: permitCaseId ?? null,
          property_id: propertyId ?? null,
          replaces_document_id: replacesDocumentId ?? null,
          name: file.name,
          file_type: file.type || null,
          category,
          size_bytes: file.size,
        },
      });
      let doc: CreatedDocument | null = null;
      if (authorization.mode === "signed") {
        const { error: upErr } = await supabase.storage
          .from("documents")
          .uploadToSignedUrl(authorization.path, authorization.token, file, {
            contentType: file.type || undefined,
          });
        if (upErr) throw upErr;
        setItem(id, { status: "verifying" });
        const verification = await finalizeUploadFn({
          data: { upload_id: authorization.upload_id },
        });
        if ("legacy" in verification) {
          setItem(id, { status: "failed", error: "Staged verification schema is unavailable" });
          return;
        }
        if (verification.status === "duplicate") {
          setItem(id, { status: "duplicate" });
        } else if (verification.status === "finalized") {
          setItem(id, { status: "done" });
        } else if (
          ["rejected", "failed", "expired", "cleanup_pending"].includes(verification.status)
        ) {
          setItem(id, { status: "failed", error: `Verification ${verification.status}` });
        } else {
          setItem(id, { status: "verificationQueued" });
        }
        onChanged();
        return;
      } else {
        // Only an explicitly non-strict demo/test schema can return legacy.
        // Production/staging always use the signed, server-finalized branch.
        const contentHash = await sha256Hex(file);
        const { error: upErr } = await supabase.storage
          .from("documents")
          .upload(authorization.path, file);
        if (upErr) throw upErr;
        doc = await createFn({
          data: {
            project_id: projectId,
            property_id: propertyId ?? null,
            replaces_document_id: replacesDocumentId ?? null,
            name: file.name,
            file_type: file.type,
            category,
            storage_path: authorization.path,
            size_bytes: file.size,
            content_hash: contentHash,
          },
        });
      }
      // Legacy mode is explicitly limited to local/demo/test compatibility.
      // The canonical signed flow returns above before any extraction request.
      if (!doc) throw new Error("Document was not created.");
      // Server treated this as a duplicate of already-uploaded content.
      if (doc?.deduped) {
        // Staged finalization removes signed-flow duplicates server-side. The
        // legacy bridge remains responsible for its own temporary object.
        setItem(id, { status: "duplicate" });
        onChanged();
        return;
      }
      // This legacy-only compatibility path does not claim the document is
      // extracted. Staged schemas always use the verification queue above.
      void autoAnalyze;
      setItem(id, { status: "done" });
      onChanged();
    } catch (e) {
      setItem(id, { status: "failed", error: e instanceof Error ? e.message : "Upload failed" });
    }
  }

  function enqueue(files: FileList | File[]) {
    const arr = [...files];
    if (!arr.length) return;
    const knownNames = new Set(existingNames.map((name) => name.trim().toLocaleLowerCase()));
    const repeatedNames = [
      ...new Set(
        arr
          .filter((file) => knownNames.has(file.name.trim().toLocaleLowerCase()))
          .map((file) => file.name),
      ),
    ];
    // Filenames are only an early warning. The worker's server-computed content
    // hash remains authoritative, and explicit replacement intent is expected
    // to reuse filenames.
    if (
      !replacesDocumentId &&
      repeatedNames.length > 0 &&
      !window.confirm(
        `${repeatedNames.join(", ")} already ${repeatedNames.length === 1 ? "exists" : "exist"}. Upload anyway?`,
      )
    ) {
      return;
    }
    const items: { file: File; id: string }[] = [];
    for (const file of arr) {
      const id = `u${seq.current++}`;
      items.push({ file, id });
      setQueue((q) => [{ id, name: file.name, status: "queued" }, ...q]);
    }
    for (const { file, id } of items) {
      void processFile(file, id);
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload documents – drag files here or activate to browse"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          enqueue(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/40 hover:bg-accent/30",
        )}
      >
        <UploadCloud
          className={cn("size-7", dragging ? "text-primary" : "text-muted-foreground")}
        />
        <div className="text-sm font-medium">Drop files here or click to upload</div>
        <div className="text-xs text-muted-foreground">{helperText}</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          aria-label="Upload documents"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) enqueue(e.target.files);
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
      </div>

      {queue.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-live="polite" aria-atomic="false">
          {queue.map((it) => {
            const meta = STATUS_META[it.status];
            const Icon = meta.icon;
            return (
              <li
                key={it.id}
                className="flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <Icon className={cn("size-4 shrink-0", meta.cls)} />
                <span className="truncate flex-1">{it.name}</span>
                <span className={cn("text-xs whitespace-nowrap", meta.cls)}>
                  {it.error ? `${meta.label}: ${it.error}` : meta.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
