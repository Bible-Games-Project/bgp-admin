import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export type AppFormValues = {
  slug: string;
  name: string;
  github_owner: string;
  github_repo: string;
  default_ref: string;
  notes: string;
  is_active: boolean;
};

export const emptyAppForm: AppFormValues = {
  slug: "",
  name: "",
  github_owner: "Bible-Games-Project",
  github_repo: "",
  default_ref: "main",
  notes: "",
  is_active: true,
};

export function AppForm({
  initial,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: AppFormValues;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (v: AppFormValues) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<AppFormValues>(initial);
  const [repoError, setRepoError] = useState<string | null>(null);

  const upd = <K extends keyof AppFormValues>(k: K, val: AppFormValues[K]) =>
    setV((s) => ({ ...s, [k]: val }));

  // Extracts the repo name from a full GitHub URL if pasted, otherwise returns the input unchanged.
  const normalizeRepo = (raw: string): string => {
    const trimmed = raw.trim();
    const urlMatch = trimmed.match(/github\.com\/[^/]+\/([^/?#]+?)(?:\.git)?(?:[/?#]|$)/i);
    if (urlMatch) return urlMatch[1];
    return trimmed;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeRepo(v.github_repo);
    if (normalized.includes("/") || /https?:/i.test(normalized) || !normalized) {
      setRepoError("Enter just the repo name (e.g. eden-choice-chronicles), no URL or slashes.");
      return;
    }
    setRepoError(null);
    onSubmit({ ...v, github_repo: normalized });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Slug" hint="lowercase, dashes (e.g. eden)">
          <Input value={v.slug} onChange={(e) => upd("slug", e.target.value)} required />
        </Field>
        <Field label="Display name">
          <Input value={v.name} onChange={(e) => upd("name", e.target.value)} required />
        </Field>
        <Field label="GitHub owner">
          <Input value={v.github_owner} onChange={(e) => upd("github_owner", e.target.value)} required />
        </Field>
        <Field label="Repo name" hint="just the repo name, e.g. eden-choice-chronicles">
          <Input
            value={v.github_repo}
            onChange={(e) => {
              upd("github_repo", e.target.value);
              if (repoError) setRepoError(null);
            }}
            onBlur={(e) => upd("github_repo", normalizeRepo(e.target.value))}
            placeholder="eden-choice-chronicles"
            required
          />
          {repoError && <p className="text-[11px] text-destructive">{repoError}</p>}
        </Field>
        <Field label="Default branch">
          <Input value={v.default_ref} onChange={(e) => upd("default_ref", e.target.value)} required />
        </Field>
        <Field label="Active">
          <div className="h-9 flex items-center">
            <Switch checked={v.is_active} onCheckedChange={(b) => upd("is_active", b)} />
          </div>
        </Field>
      </div>

      <Field label="Notes">
        <Textarea
          value={v.notes}
          onChange={(e) => upd("notes", e.target.value)}
          rows={3}
          placeholder="Optional internal notes"
        />
      </Field>

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-mono uppercase text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
