import { useCallback, useState } from "react";
import { FileText, Loader2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import {
  ATTACHMENTS_PER_MESSAGE,
  attachmentKind,
  attachmentProblem,
  attachmentType,
  formatBytes,
  type BuildAttachment,
} from "@/lib/agent";
import { cn } from "@/lib/utils";

// Files sent with a Build chat message. Each is uploaded as soon as it's picked (or dropped,
// or pasted), shows as a chip under the message box while the message is written, and goes
// with the message when it's sent. See uploadBuildAttachment in agent.functions.ts.

export type PendingAttachment = {
  key: string;
  name: string;
  size: number;
  kind: "image" | "pdf" | "text";
  /** An object URL of the image, for the chip. */
  preview: string | null;
  status: "uploading" | "ready" | "failed";
  saved?: BuildAttachment;
};

const THUMBNAIL_PX = 192;

/** A small JPEG of an image, as a data: URL, for the chat to show with the message. */
export async function thumbnailOf(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("not an image"));
      el.src = url;
    });
    const scale = Math.min(1, THUMBNAIL_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.75);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function usePendingAttachments(
  upload: (file: File, thumbnail: string | null) => Promise<BuildAttachment>,
) {
  const [pending, setPending] = useState<PendingAttachment[]>([]);

  // Not inside the state updater: that runs twice in development (StrictMode), and this
  // starts uploads and shows toasts.
  const count = pending.length;
  const add = useCallback(
    (files: File[]) => {
      const room = ATTACHMENTS_PER_MESSAGE - count;
      if (files.length > room) {
        toast.error(`At most ${ATTACHMENTS_PER_MESSAGE} files go with one message.`);
      }
      const added: PendingAttachment[] = [];
      for (const file of files.slice(0, Math.max(0, room))) {
        const problem = attachmentProblem(file);
        if (problem) {
          toast.error(problem, { duration: 8000 });
          continue;
        }
        const kind = attachmentKind(attachmentType(file.name)!);
        const key = crypto.randomUUID();
        added.push({
          key,
          name: file.name,
          size: file.size,
          kind,
          preview: kind === "image" ? URL.createObjectURL(file) : null,
          status: "uploading",
        });
        (async () => {
          try {
            const thumbnail = kind === "image" ? await thumbnailOf(file) : null;
            const saved = await upload(file, thumbnail);
            setPending((p) => p.map((a) => (a.key === key ? { ...a, status: "ready", saved } : a)));
          } catch (error) {
            setPending((p) => p.map((a) => (a.key === key ? { ...a, status: "failed" } : a)));
            toast.error(`${file.name}: ${(error as Error).message}`, { duration: 10_000 });
          }
        })();
      }
      if (added.length) setPending((current) => [...current, ...added]);
    },
    [count, upload],
  );

  const remove = useCallback((key: string) => {
    setPending((current) => {
      const gone = current.find((a) => a.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return current.filter((a) => a.key !== key);
    });
  }, []);

  const clear = useCallback(() => {
    setPending((current) => {
      for (const a of current) if (a.preview) URL.revokeObjectURL(a.preview);
      return [];
    });
  }, []);

  return {
    pending,
    add,
    remove,
    clear,
    uploading: pending.some((a) => a.status === "uploading"),
    ids: pending.flatMap((a) => (a.status === "ready" && a.saved ? [a.saved.id] : [])),
  };
}

/** The files picked for the next message, each with a way to drop it. */
export function PendingChips({
  pending,
  onRemove,
}: {
  pending: PendingAttachment[];
  onRemove: (key: string) => void;
}) {
  if (!pending.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {pending.map((a) => (
        <span
          key={a.key}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 pl-1.5 pr-1 py-1 text-xs max-w-full",
            a.status === "failed" && "border-destructive/50",
          )}
          title={`${a.name} · ${formatBytes(a.size)}`}
        >
          {a.preview ? (
            <img src={a.preview} alt="" className="h-6 w-6 rounded object-cover shrink-0" />
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate max-w-[10rem]">{a.name}</span>
          {a.status === "uploading" && (
            <Loader2 className="h-3 w-3 animate-spin shrink-0 text-muted-foreground" />
          )}
          {a.status === "failed" && <TriangleAlert className="h-3 w-3 shrink-0 text-destructive" />}
          <button
            type="button"
            onClick={() => onRemove(a.key)}
            className="rounded p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${a.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

/** The files that went with a message, in its bubble. */
export function AttachmentList({
  attachments,
  onOpen,
}: {
  attachments: BuildAttachment[];
  onOpen: (attachment: BuildAttachment) => void;
}) {
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-1.5">
      {attachments.map((a) =>
        a.thumbnail ? (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpen(a)}
            title={`${a.name} · ${formatBytes(a.size)} · open`}
            className="rounded-md overflow-hidden border border-border hover:opacity-90"
          >
            <img src={a.thumbnail} alt={a.name} className="h-20 max-w-[10rem] object-cover" />
          </button>
        ) : (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpen(a)}
            title={`${formatBytes(a.size)} · open`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-xs hover:bg-background max-w-full"
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate max-w-[12rem]">{a.name}</span>
          </button>
        ),
      )}
    </div>
  );
}
