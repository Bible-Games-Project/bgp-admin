import { useState, type ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { charCount, localeLabel, sortByLabel } from "@/lib/store-listing";

/** An input or textarea with the store's character limit counted live. */
export function LimitedField({
  id,
  label,
  hint,
  value,
  limit,
  readOnly,
  multiline,
  rows,
  placeholder,
  showCount = true,
  changed,
  onChange,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  value: string;
  limit: number;
  readOnly?: boolean;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  showCount?: boolean;
  changed?: boolean;
  onChange: (value: string) => void;
}) {
  const count = charCount(value);
  const over = count > limit;
  // readOnly rather than disabled: a live listing has to stay legible.
  const shared = {
    id,
    value,
    readOnly,
    placeholder: readOnly ? undefined : placeholder,
    className: cn(readOnly && "bg-muted/40 focus-visible:ring-0", over && "border-destructive"),
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-sm">
          {label}
          {changed && (
            <span className="ml-1.5 text-xs font-normal text-amber-600 dark:text-amber-400">
              edited
            </span>
          )}
        </Label>
        {(showCount || over) && (
          <span
            className={cn(
              "text-xs tabular-nums",
              over ? "text-destructive font-medium" : "text-muted-foreground",
            )}
          >
            {count} / {limit}
          </span>
        )}
      </div>
      {multiline ? <Textarea rows={rows ?? 4} {...shared} /> : <Input {...shared} />}
      {over && (
        <p className="text-xs text-destructive">
          {count - limit} character{count - limit === 1 ? "" : "s"} over the store&apos;s limit.
        </p>
      )}
      {hint && !over && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "error";
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-xs",
        tone === "info" && "border-border bg-muted/40",
        tone === "warn" && "border-amber-500/40 bg-amber-500/10",
        tone === "error" && "border-destructive/50 bg-destructive/10",
      )}
    >
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cn("text-muted-foreground", title && "mt-1")}>{children}</div>}
    </div>
  );
}

/** Language dropdown. `marks` adds a short note after a language, e.g. "primary". */
export function LanguageSelect({
  value,
  languages,
  marks,
  onChange,
}: {
  value: string | null;
  languages: string[];
  marks?: Record<string, string>;
  onChange: (code: string) => void;
}) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-72">
        <SelectValue placeholder="Choose a language" />
      </SelectTrigger>
      <SelectContent>
        {sortByLabel(languages).map((code) => (
          <SelectItem key={code} value={code}>
            {localeLabel(code)}
            {marks?.[code] && <span className="text-muted-foreground"> · {marks[code]}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AddLanguageDialog({
  open,
  onOpenChange,
  options,
  description,
  pending,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: string[];
  description: ReactNode;
  pending?: boolean;
  onAdd: (code: string) => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setChoice(null);
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a language</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <LanguageSelect value={choice} languages={options} onChange={setChoice} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => choice && onAdd(choice)} disabled={!choice || pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Add {choice ? localeLabel(choice) : "language"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RefreshButton({
  fetching,
  onClick,
  className,
}: {
  fetching: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={fetching}
      className={cn(
        "text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1",
        className,
      )}
      title="Read again from the store"
    >
      <RefreshCw className={cn("h-3.5 w-3.5", fetching && "animate-spin")} /> Refresh
    </button>
  );
}
