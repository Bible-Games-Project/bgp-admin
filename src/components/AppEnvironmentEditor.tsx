import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Trash2, Save } from "lucide-react";
import { getEnvFile, updateEnvFile } from "@/lib/env.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type EnvVar = {
  key: string;
  value: string;
  isNew?: boolean;
};

export function AppEnvironmentEditor({
  appId,
  onSuccess,
}: {
  appId: string;
  onSuccess?: () => void;
}) {
  const qc = useQueryClient();
  const getEnvFn = useServerFn(getEnvFile);
  const updateEnvFn = useServerFn(updateEnvFile);
  
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const envQuery = useQuery({
    queryKey: ["env", appId],
    queryFn: () => getEnvFn({ data: { appId } }),
  });

  const updateMutation = useMutation({
    mutationFn: (env: Record<string, string>) =>
      updateEnvFn({
        data: {
          appId,
          env,
          sha: envQuery.data?.sha ?? null,
        },
      }),
    onSuccess: () => {
      toast.success("Environment variables saved and pushed to GitHub");
      setHasChanges(false);
      qc.invalidateQueries({ queryKey: ["env", appId] });
      onSuccess?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Initialize vars from query data
  useEffect(() => {
    if (envQuery.data?.env) {
      const envVars = Object.entries(envQuery.data.env).map(([key, value]) => ({
        key,
        value,
      }));
      setVars(envVars);
      setHasChanges(false);
    }
  }, [envQuery.data]);

  const handleAddVar = () => {
    setVars([...vars, { key: "", value: "", isNew: true }]);
    setHasChanges(true);
  };

  const handleRemoveVar = (index: number) => {
    setVars(vars.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const handleKeyChange = (index: number, key: string) => {
    const newVars = [...vars];
    newVars[index] = { ...newVars[index], key };
    setVars(newVars);
    setHasChanges(true);
  };

  const handleValueChange = (index: number, value: string) => {
    const newVars = [...vars];
    newVars[index] = { ...newVars[index], value };
    setVars(newVars);
    setHasChanges(true);
  };

  const handleSave = () => {
    // Validate: all keys must be non-empty and unique
    const keys = vars.map((v) => v.key.trim()).filter((k) => k);
    const uniqueKeys = new Set(keys);
    
    if (keys.length !== uniqueKeys.size) {
      toast.error("Duplicate keys found. Each variable name must be unique.");
      return;
    }
    
    if (vars.some((v) => !v.key.trim())) {
      toast.error("All variable names must be non-empty.");
      return;
    }

    // Convert to record
    const env = vars.reduce((acc, v) => {
      const key = v.key.trim();
      if (key) {
        acc[key] = v.value;
      }
      return acc;
    }, {} as Record<string, string>);

    updateMutation.mutate(env);
  };

  if (envQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading environment variables…
      </div>
    );
  }

  if (envQuery.error) {
    return (
      <div className="text-sm text-destructive p-4">
        {(envQuery.error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold mb-1">Environment Variables</h2>
          <p className="text-sm text-muted-foreground">
            Manage production environment variables in <code className="text-xs">.env.production</code>
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={handleAddVar}
        >
          <Plus className="h-4 w-4" /> Add Variable
        </Button>
      </div>

      {!envQuery.data?.exists && vars.length === 0 && (
        <div className="rounded-md border border-dashed border-border bg-muted/30 p-8 text-center">
          <p className="text-sm text-muted-foreground mb-3">
            No <code className="text-xs">.env.production</code> file found in this repository.
          </p>
          <Button size="sm" variant="outline" onClick={handleAddVar}>
            <Plus className="h-4 w-4 mr-2" /> Add First Variable
          </Button>
        </div>
      )}

      {vars.length > 0 && (
        <div className="space-y-3">
          {vars.map((envVar, index) => (
            <div
              key={index}
              className="flex items-start gap-3 p-3 rounded-md border border-border bg-card"
            >
              <div className="flex-1 grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor={`key-${index}`} className="text-xs">
                    Variable Name
                  </Label>
                  <Input
                    id={`key-${index}`}
                    value={envVar.key}
                    onChange={(e) => handleKeyChange(index, e.target.value)}
                    placeholder="VARIABLE_NAME"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`value-${index}`} className="text-xs">
                    Value
                  </Label>
                  <Input
                    id={`value-${index}`}
                    value={envVar.value}
                    onChange={(e) => handleValueChange(index, e.target.value)}
                    placeholder="value"
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive mt-6"
                onClick={() => handleRemoveVar(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {vars.length > 0 && (
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
      )}
    </div>
  );
}
