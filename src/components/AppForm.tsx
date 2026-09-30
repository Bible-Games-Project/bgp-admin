import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { slugify } from "@/lib/utils";

const GITHUB_ORG = "Bible-Games-Project";

export type AppFormValues = {
  name: string;
  github_owner: string;
  github_repo: string;
  default_ref: string;
  bundle_id: string;
  android_package_name: string;
  steam_app_id: string;
  notes: string;
  is_active: boolean;
};

export const emptyAppForm: AppFormValues = {
  name: "",
  github_owner: "Bible-Games-Project",
  github_repo: "",
  default_ref: "main",
  bundle_id: "",
  android_package_name: "",
  steam_app_id: "",
  notes: "",
  is_active: true,
};

/**
 * A web game in a repo the console links or creates, or a game made with another
 * engine, which the console doesn't build (see src/lib/app-kind.ts).
 */
export type AppFormMode = "link" | "create" | "external";

/** The Steam App ID as the server expects it, or an error to show under the field. */
export function parseSteamAppId(raw: string): { value: number | null; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null };
  // A pasted store address works too: store.steampowered.com/app/2298350/Name/
  const fromUrl = trimmed.match(/\/app\/(\d+)/)?.[1];
  const digits = fromUrl ?? trimmed;
  if (!/^\d+$/.test(digits)) {
    return { value: null, error: "Enter just the number, e.g. 2298350 from store.steampowered.com/app/2298350." };
  }
  return { value: Number(digits) };
}

export function AppForm({
  initial,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
  showCreateRepoOption = false,
  external = false,
}: {
  initial: AppFormValues;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (v: AppFormValues, meta: { mode: AppFormMode }) => void;
  onCancel?: () => void;
  /** New-app dialog: offers linking a repo, creating one, or a game that isn't a web game. */
  showCreateRepoOption?: boolean;
  /** Editing a game that isn't a web game: store IDs instead of a repo. */
  external?: boolean;
}) {
  const [v, setV] = useState<AppFormValues>(initial);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [steamError, setSteamError] = useState<string | null>(null);
  const [mode, setMode] = useState<AppFormMode>(external ? "external" : "link");
  const [repoTouched, setRepoTouched] = useState(Boolean(initial.github_repo));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const createRepo = showCreateRepoOption && mode === "create";
  const isExternal = mode === "external";

  const upd = <K extends keyof AppFormValues>(k: K, val: AppFormValues[K]) =>
    setV((s) => ({ ...s, [k]: val }));

  // While creating a repo, its name follows the app name until the user edits it.
  // A linked repo already has a name of its own (Lovable names it after the
  // project), so there it is never guessed from the app name.
  const handleNameChange = (val: string) => {
    setV((s) => ({
      ...s,
      name: val,
      github_repo: !repoTouched && createRepo ? slugify(val) : s.github_repo,
    }));
  };

  const handleModeChange = (next: AppFormMode) => {
    setMode(next);
    setRepoError(null);
    setStoreError(null);
    if (!repoTouched) upd("github_repo", next === "create" ? slugify(v.name) : "");
  };

  const handleRepoChange = (val: string) => {
    setRepoTouched(true);
    upd("github_repo", val);
    if (repoError) setRepoError(null);
  };

  // Extracts the repo name from a full GitHub URL if pasted, otherwise returns the input unchanged.
  const normalizeRepo = (raw: string): string => {
    const trimmed = raw.trim();
    const urlMatch = trimmed.match(/github\.com\/[^/]+\/([^/?#]+?)(?:\.git)?(?:[/?#]|$)/i);
    if (urlMatch) return urlMatch[1];
    return trimmed;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const steam = parseSteamAppId(v.steam_app_id);
    setSteamError(steam.error ?? null);
    if (steam.error) {
      // On a web game the field sits in the collapsed Advanced section.
      setAdvancedOpen(true);
      return;
    }
    const values = { ...v, steam_app_id: steam.value == null ? "" : String(steam.value) };

    if (isExternal) {
      if (!v.bundle_id.trim() && !v.android_package_name.trim() && steam.value == null) {
        setStoreError("Enter at least one of the three: where the game is published.");
        return;
      }
      setStoreError(null);
      onSubmit(values, { mode: "external" });
      return;
    }

    const normalized = normalizeRepo(v.github_repo);
    if (normalized.includes("/") || /https?:/i.test(normalized) || !normalized) {
      setRepoError(
        createRepo
          ? "Enter just the new repo name (e.g. eden-choice-chronicles), no URL or slashes."
          : "Enter just the repo name (e.g. eden-choice-chronicles), no URL or slashes.",
      );
      return;
    }
    setRepoError(null);
    onSubmit(
      { ...values, github_owner: createRepo ? GITHUB_ORG : v.github_owner, github_repo: normalized },
      { mode: createRepo ? "create" : "link" },
    );
  };

  const steamField = (
    <Field
      label="Steam App ID"
      hint="The number in the game's Steam store address, e.g. 2298350 from store.steampowered.com/app/2298350. Leave it empty if the game isn't on Steam."
    >
      <Input
        value={v.steam_app_id}
        onChange={(e) => {
          upd("steam_app_id", e.target.value);
          if (steamError) setSteamError(null);
        }}
        placeholder="2298350"
        inputMode="numeric"
      />
      {steamError && <p className="text-[11px] text-destructive">{steamError}</p>}
    </Field>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {showCreateRepoOption && (
        <div className="space-y-1.5">
          <Label className="text-xs font-mono uppercase text-muted-foreground">Game</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            value={mode}
            onValueChange={(val) => {
              if (val) handleModeChange(val as AppFormMode);
            }}
            className="justify-start flex-wrap"
          >
            <ToggleGroupItem value="link">Link existing repo</ToggleGroupItem>
            <ToggleGroupItem value="create">Create new repo</ToggleGroupItem>
            <ToggleGroupItem value="external">Not a web game (Unity, RPG Maker…)</ToggleGroupItem>
          </ToggleGroup>
          {isExternal && (
            <p className="text-[11px] text-muted-foreground">
              For a game made with another engine, like The Lost Sheep (Unity). Its code can be in
              any repo, but the console doesn't build or release it: that stays in Unity, Xcode,
              Play Console or Steamworks. Here you get its store pages, and you can edit the App
              Store and Google Play ones.
            </p>
          )}
        </div>
      )}

      <Field
        label="App name"
        hint={
          isExternal
            ? showCreateRepoOption
              ? "How the game is called in this console. Leave it empty to use the name it has in the stores."
              : "How the game is called in this console. The name players see is set in the game's own project and in the Store tab."
            : createRepo
            ? "The name under the app icon on players' phones. The repo name below is filled in from it. The name in the stores is separate: set it in the app's Store tab once the app exists in App Store Connect and Google Play."
            : showCreateRepoOption
            ? "The name under the app icon on players' phones. The name in the stores is separate: set it in the app's Store tab once the app exists in App Store Connect and Google Play."
            : "The name under the app icon on players' phones. Saving a new name commits it to the app repo; players see it once a new build is released to production and they update. The name in the stores is separate: set it in the Store tab."
        }
      >
        <Input
          value={v.name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder={isExternal ? "The Lost Sheep" : "Eden's Choice: Chronicles"}
          maxLength={100}
          required={!(isExternal && showCreateRepoOption)}
        />
      </Field>

      {isExternal ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="App Store bundle ID"
              hint="App Store Connect → the app → General → App Information → Bundle ID. Leave it empty if the game isn't on the App Store."
            >
              <Input
                value={v.bundle_id}
                onChange={(e) => {
                  upd("bundle_id", e.target.value);
                  if (storeError) setStoreError(null);
                }}
                placeholder="com.company.game"
              />
            </Field>
            <Field
              label="Google Play package name"
              hint="Play Console → the app, on the line under its name. Often the same as the bundle ID. Leave it empty if the game isn't on Google Play."
            >
              <Input
                value={v.android_package_name}
                onChange={(e) => {
                  upd("android_package_name", e.target.value);
                  if (storeError) setStoreError(null);
                }}
                placeholder="com.company.game"
              />
            </Field>
            {steamField}
            <Field label="Active">
              <div className="h-9 flex items-center">
                <Switch checked={v.is_active} onCheckedChange={(b) => upd("is_active", b)} />
              </div>
            </Field>
          </div>
          {storeError && <p className="text-[11px] text-destructive">{storeError}</p>}
          <Field label="Notes">
            <Textarea
              value={v.notes}
              onChange={(e) => upd("notes", e.target.value)}
              rows={3}
              placeholder="Optional internal notes"
            />
          </Field>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {createRepo ? (
              <>
                <Field label="GitHub org" hint="fixed for all apps">
                  <Input value={GITHUB_ORG} disabled />
                </Field>
                <Field
                  label="New repo name"
                  hint="filled in from the app name — change it only if you need a different repo"
                >
                  <Input
                    value={v.github_repo}
                    onChange={(e) => handleRepoChange(e.target.value)}
                    onBlur={(e) => upd("github_repo", normalizeRepo(e.target.value))}
                    placeholder={slugify(v.name) || "eden-choice-chronicles"}
                    required
                  />
                  {repoError && <p className="text-[11px] text-destructive">{repoError}</p>}
                </Field>
              </>
            ) : (
              <>
                <Field label="GitHub owner">
                  <Input value={v.github_owner} onChange={(e) => upd("github_owner", e.target.value)} required />
                </Field>
                <Field
                  label="Repo name"
                  hint="Copy it exactly from the repo's page on GitHub. A repo linked from Lovable is named after the Lovable project, so it is often different from the app name."
                >
                  <Input
                    value={v.github_repo}
                    onChange={(e) => handleRepoChange(e.target.value)}
                    onBlur={(e) => upd("github_repo", normalizeRepo(e.target.value))}
                    placeholder="eden-choice-chronicles"
                    required
                  />
                  {repoError && <p className="text-[11px] text-destructive">{repoError}</p>}
                </Field>
              </>
            )}
            <Field label="Active">
              <div className="h-9 flex items-center">
                <Switch checked={v.is_active} onCheckedChange={(b) => upd("is_active", b)} />
              </div>
            </Field>
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs font-mono uppercase text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-90" : ""}`} />
                Advanced
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Default branch">
                  <Input value={v.default_ref} onChange={(e) => upd("default_ref", e.target.value)} required />
                </Field>
                <Field
                  label="Bundle ID / Package name"
                  hint="One identifier for both stores: App Store Connect calls it Bundle ID, Google Play Console calls it Package name. Enter the exact same value in both. The stores never let you change it once the app is created there."
                >
                  <Input
                    value={v.bundle_id}
                    onChange={(e) => upd("bundle_id", e.target.value)}
                    placeholder="com.acme.app"
                  />
                </Field>
                {/* A new web game can't be on Steam yet, so this only shows once it exists. */}
                {!showCreateRepoOption && steamField}
              </div>

              <Field label="Notes">
                <Textarea
                  value={v.notes}
                  onChange={(e) => upd("notes", e.target.value)}
                  rows={3}
                  placeholder="Optional internal notes"
                />
              </Field>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? (isExternal && showCreateRepoOption ? "Checking the stores…" : "Saving…") : submitLabel}
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
