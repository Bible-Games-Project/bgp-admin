import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AppFormValues = {
  slug: string;
  name: string;
  github_owner: string;
  github_repo: string;
  default_ref: string;
  ios_bundle_id: string;
  ios_workflow_file: string;
  android_package_name: string;
  android_workflow_file: string;
  android_play_track: "internal" | "alpha" | "beta" | "production";
  notes: string;
  is_active: boolean;
};

export const emptyAppForm: AppFormValues = {
  slug: "",
  name: "",
  github_owner: "Bible-Games-Project",
  github_repo: "",
  default_ref: "main",
  ios_bundle_id: "",
  ios_workflow_file: "deploy-ios.yml",
  android_package_name: "",
  android_workflow_file: "deploy-android.yml",
  android_play_track: "internal",
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

  const upd = <K extends keyof AppFormValues>(k: K, val: AppFormValues[K]) =>
    setV((s) => ({ ...s, [k]: val }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
      className="space-y-6"
    >
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
        <Field label="GitHub repo">
          <Input value={v.github_repo} onChange={(e) => upd("github_repo", e.target.value)} required />
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

      <div>
        <div className="label-mono mb-2">iOS</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Bundle ID">
            <Input
              value={v.ios_bundle_id}
              onChange={(e) => upd("ios_bundle_id", e.target.value)}
              placeholder="com.biblegames.eden"
            />
          </Field>
          <Field label="Workflow file">
            <Input
              value={v.ios_workflow_file}
              onChange={(e) => upd("ios_workflow_file", e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div>
        <div className="label-mono mb-2">Android</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Package name">
            <Input
              value={v.android_package_name}
              onChange={(e) => upd("android_package_name", e.target.value)}
              placeholder="com.biblegames.eden"
            />
          </Field>
          <Field label="Workflow file">
            <Input
              value={v.android_workflow_file}
              onChange={(e) => upd("android_workflow_file", e.target.value)}
            />
          </Field>
          <Field label="Play track">
            <Select
              value={v.android_play_track}
              onValueChange={(val) => upd("android_play_track", val as AppFormValues["android_play_track"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">internal</SelectItem>
                <SelectItem value="alpha">alpha</SelectItem>
                <SelectItem value="beta">beta</SelectItem>
                <SelectItem value="production">production</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
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
