import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { UploadCloud, FileText, Loader2, CheckCircle2, XCircle, CopyX } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { createDocument, analyzeDocument } from "@/lib/documents.functions";
import { cn } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";

type CreatedDocument = Tables<"documents"> & { deduped?: boolean };

const ACCEPT = ".pdf,.xlsx,.xls,.doc,.docx,.csv,.png,.jpg,.jpeg";
const ACCEPT_RE = /\.(pdf|xlsx|xls|docx?|csv|png|jpe?g)$/i;
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

type ItemStatus = "queued" | "uploading" | "analyzing" | "done" | "failed" | "duplicate";
type QueueItem = { id: string; name: string; status: ItemStatus; error?: string };

const STATUS_META: Record<ItemStatus, { icon: LucideIcon; cls: string; label: string }> = {
  queued: { icon: FileText, cls: "text-muted-foreground", label: "Queued" },
  uploading: { icon: Loader2, cls: "text-primary animate-spin", label: "Uploading…" },
  analyzing: { icon: Loader2, cls: "text-primary animate-spin", label: "Extracting…" },
  done: { icon: CheckCircle2, cls: "text-success", label: "Extracted" },
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
  category,
  existingNames,
  onChanged,
  autoAnalyze = true,
}: {
  projectId: string | null;
  category: string;
  existingNames: string[];
  onChanged: () => void;
  autoAnalyze?: boolean;
}) {
  const createFn = useServerFn(createDocument);
  const analyzeFn = useServerFn(analyzeDocument);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  // Counter for stable local ids without Math.random/Date in render.
  const seq = useRef(0);

  function setItem(id: string, patch: Partial<QueueItem>) {
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function processFile(file: File, id: string, existing: Set<string>) {
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
    if (existing.has(file.name.toLowerCase())) {
      setItem(id, { status: "duplicate" });
      return;
    }
    try {
      setItem(id, { status: "uploading" });
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not authenticated");
      const contentHash = await sha256Hex(file);
      const path = `${u.user.id}/${id}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
      if (upErr) throw upErr;
      const doc: CreatedDocument = await createFn({
        data: {
          project_id: projectId,
          name: file.name,
          file_type: file.type,
          category,
          storage_path: path,
          size_bytes: file.size,
          content_hash: contentHash,
        },
      });
      // Server treated this as a duplicate of already-uploaded content.
      if (doc?.deduped) {
        setItem(id, { status: "duplicate" });
        onChanged();
        return;
      }
      if (autoAnalyze) {
        setItem(id, { status: "analyzing" });
        try {
          await analyzeFn({ data: { id: doc.id, name: file.name, category } });
        } catch (e) {
          // Extraction failure is non-fatal: the file is uploaded; surface why.
          setItem(id, {
            status: "failed",
            error: e instanceof Error ? e.message : "Extraction failed",
          });
          onChanged();
          return;
        }
      }
      setItem(id, { status: "done" });
      onChanged();
    } catch (e) {
      setItem(id, { status: "failed", error: e instanceof Error ? e.message : "Upload failed" });
    }
  }

  function enqueue(files: FileList | File[]) {
    const arr = [...files];
    if (!arr.length) return;
    const existing = new Set(existingNames.map((n) => n.toLowerCase()));
    // Also guard against duplicates within the same drop.
    const seen = new Set<string>();
    const items: { file: File; id: string }[] = [];
    for (const file of arr) {
      const id = `u${seq.current++}`;
      items.push({ file, id });
      const dup = existing.has(file.name.toLowerCase()) || seen.has(file.name.toLowerCase());
      seen.add(file.name.toLowerCase());
      setQueue((q) => [{ id, name: file.name, status: dup ? "duplicate" : "queued" }, ...q]);
    }
    for (const { file, id } of items) {
      if (!existing.has(file.name.toLowerCase())) void processFile(file, id, existing);
      existing.add(file.name.toLowerCase());
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
        <div className="text-xs text-muted-foreground">
          Multiple files supported · PDF, Excel, Word, CSV, images · assumptions are extracted
          automatically
        </div>
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
