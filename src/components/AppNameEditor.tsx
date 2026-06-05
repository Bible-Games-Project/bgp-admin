import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Save } from "lucide-react";
import { getAppName, updateAppName } from "@/lib/app-name.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function AppNameEditor({
  appId,
  onSuccess,
}: {
  appId: string;
  onSuccess?: () => void;
}) {
  const qc = useQueryClient();
  const getAppNameFn = useServerFn(getAppName);
  const updateAppNameFn = useServerFn(updateAppName);
  
  const [appName, setAppName] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  const nameQuery = useQuery({
    queryKey: ["app-name", appId],
    queryFn: () => getAppNameFn({ data: { appId } }),
  });

  const updateMutation = useMutation({
    mutationFn: (name: string) =>
      updateAppNameFn({
        data: {
          appId,
          appName: name,
        },
      }),
    onSuccess: () => {
      toast.success("App name updated and pushed to GitHub");
      setHasChanges(false);
      qc.invalidateQueries({ queryKey: ["app-name", appId] });
      onSuccess?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Initialize name from query data
  useEffect(() => {
    if (nameQuery.data?.appName) {
      setAppName(nameQuery.data.appName);
      setHasChanges(false);
    }
  }, [nameQuery.data]);

  const handleNameChange = (value: string) => {
    setAppName(value);
    setHasChanges(value !== nameQuery.data?.appName);
  };

  const handleSave = () => {
    if (!appName.trim()) {
      toast.error("App name cannot be empty.");
      return;
    }

    if (appName.length > 100) {
      toast.error("App name is too long (max 100 characters).");
      return;
    }

    updateMutation.mutate(appName);
  };

  if (nameQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading app name…
      </div>
    );
  }

  if (nameQuery.error) {
    return (
      <div className="text-sm text-destructive p-4">
        {(nameQuery.error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold mb-1">App Name</h2>
        <p className="text-sm text-muted-foreground">
          The display name shown to users on their device. This will be updated in:
        </p>
        <ul className="text-xs text-muted-foreground list-disc list-inside mt-2 space-y-1">
          <li><code>capacitor.config.ts</code></li>
          <li><code>android/app/src/main/res/values/strings.xml</code></li>
          <li><code>ios/App/App/Info.plist</code></li>
        </ul>
      </div>

      <div className="space-y-2">
        <Label htmlFor="app-name" className="text-sm">
          Display Name
        </Label>
        <Input
          id="app-name"
          value={appName}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="My Awesome App"
          maxLength={100}
          className="max-w-md"
        />
        <p className="text-xs text-muted-foreground">
          {appName.length}/100 characters
        </p>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Changes will be committed and pushed to the repository.
        </p>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || updateMutation.isPending}
          className="gap-2"
        >
          {updateMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Save className="h-4 w-4" /> Save & Push
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
