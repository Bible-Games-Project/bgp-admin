import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, ExternalLink, RefreshCw, ImageOff } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { uploadAndGenerateAsset } from "@/lib/asset-generation.functions";
import { getAppAssetPreview } from "@/lib/app-assets.functions";

type AssetType = "icon" | "splash";

interface AppAssetUploadProps {
  type: AssetType;
  appId: string;
  onSuccess: () => void;
}

export function AppAssetUpload({ type, appId, onSuccess }: AppAssetUploadProps) {
  const [lightFile, setLightFile] = useState<File | null>(null);
  const [darkFile, setDarkFile] = useState<File | null>(null);
  const [lightPreview, setLightPreview] = useState<string | null>(null);
  const [darkPreview, setDarkPreview] = useState<string | null>(null);
  const [splashBgLight, setSplashBgLight] = useState("#ffffff");
  const [splashBgDark, setSplashBgDark] = useState("#000000");
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string>("");

  const lightInputRef = useRef<HTMLInputElement>(null);
  const darkInputRef = useRef<HTMLInputElement>(null);

  const minSize = type === "icon" ? 1024 : 2732;
  const typeLabel = type === "icon" ? "Icon" : "Splash Screen";

  const uploadFn = useServerFn(uploadAndGenerateAsset);
  const previewFn = useServerFn(getAppAssetPreview);
  const qc = useQueryClient();

  const previewQuery = useQuery({
    queryKey: ["app-asset-preview", appId, type],
    queryFn: () => previewFn({ data: { appId, type } }),
    staleTime: 30_000,
  });

  const validateImage = async (file: File): Promise<{ valid: boolean; error?: string }> => {
    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return { valid: false, error: "File size must be less than 5MB" };
    }

    // Check file type
    if (!file.type.match(/^image\/(png|jpeg)$/)) {
      return { valid: false, error: "Only PNG and JPEG files are supported" };
    }

    // Check dimensions
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        if (img.width < minSize || img.height < minSize) {
          resolve({
            valid: false,
            error: `Image must be at least ${minSize}×${minSize}px (got ${img.width}×${img.height}px)`,
          });
        } else if (img.width !== img.height) {
          resolve({ valid: false, error: "Image must be square (width = height)" });
        } else {
          resolve({ valid: true });
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        resolve({ valid: false, error: "Invalid image file" });
      };
      img.src = URL.createObjectURL(file);
    });
  };

  const handleFileSelect = async (
    file: File | null,
    mode: "light" | "dark"
  ) => {
    if (!file) {
      if (mode === "light") {
        setLightFile(null);
        setLightPreview(null);
      } else {
        setDarkFile(null);
        setDarkPreview(null);
      }
      return;
    }

    const validation = await validateImage(file);
    if (!validation.valid) {
      toast.error(validation.error);
      if (mode === "light" && lightInputRef.current) {
        lightInputRef.current.value = "";
      }
      if (mode === "dark" && darkInputRef.current) {
        darkInputRef.current.value = "";
      }
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      const preview = reader.result as string;
      if (mode === "light") {
        setLightFile(file);
        setLightPreview(preview);
      } else {
        setDarkFile(file);
        setDarkPreview(preview);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!lightFile) {
      toast.error(`Please select a ${typeLabel.toLowerCase()} image`);
      return;
    }

    setUploading(true);
    setStatus("Preparing upload...");

    try {
      // Convert files to Uint8Array
      const lightBuffer = await lightFile.arrayBuffer();
      const lightData = new Uint8Array(lightBuffer);

      let darkData: Uint8Array | undefined;
      if (darkFile) {
        const darkBuffer = await darkFile.arrayBuffer();
        darkData = new Uint8Array(darkBuffer);
      }

      setStatus("Cloning repository...");

      // Call server function
      const result = await uploadFn({
        data: {
          appId,
          type,
          imageData: lightData,
          imageDarkData: darkData,
          splashBgColor: type === "splash" ? splashBgLight : undefined,
          splashBgColorDark: type === "splash" ? splashBgDark : undefined,
        },
      });

      if (result.commitUrl) {
        toast.success(
          <div className="flex items-center gap-2">
            <span>{result.message}</span>
            <a
              href={result.commitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              View commit <ExternalLink className="w-3 h-3" />
            </a>
          </div>,
          { duration: 8000 }
        );
      } else {
        toast.success(result.message);
      }

      // Reset form
      setLightFile(null);
      setDarkFile(null);
      setLightPreview(null);
      setDarkPreview(null);
      if (lightInputRef.current) lightInputRef.current.value = "";
      if (darkInputRef.current) darkInputRef.current.value = "";

      onSuccess();
    } catch (error) {
      console.error("Upload failed:", error);
      toast.error(
        error instanceof Error ? error.message : "Asset generation failed"
      );
    } finally {
      setUploading(false);
      setStatus("");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-2">
            Upload {typeLabel} (Light Mode)
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Select a square image (minimum {minSize}×{minSize}px, PNG or JPG,
            max 5MB)
          </p>
          <Input
            ref={lightInputRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null, "light")}
            disabled={uploading}
          />
          {lightPreview && (
            <div className="mt-4">
              <img
                src={lightPreview}
                alt="Light mode preview"
                className="w-32 h-32 object-cover rounded border"
              />
            </div>
          )}
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-2">
            Upload {typeLabel} (Dark Mode) - Optional
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Optionally upload a dark mode variant (same size requirements)
          </p>
          <Input
            ref={darkInputRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null, "dark")}
            disabled={uploading}
          />
          {darkPreview && (
            <div className="mt-4">
              <img
                src={darkPreview}
                alt="Dark mode preview"
                className="w-32 h-32 object-cover rounded border"
              />
            </div>
          )}
        </div>

        {type === "splash" && (
          <div className="space-y-4 pt-4 border-t">
            <div>
              <Label htmlFor="bg-light">Background Color (Light Mode)</Label>
              <div className="flex gap-2 items-center mt-2">
                <Input
                  id="bg-light"
                  type="color"
                  value={splashBgLight}
                  onChange={(e) => setSplashBgLight(e.target.value)}
                  disabled={uploading}
                  className="w-20 h-9 cursor-pointer"
                />
                <Input
                  type="text"
                  value={splashBgLight}
                  onChange={(e) => setSplashBgLight(e.target.value)}
                  disabled={uploading}
                  placeholder="#ffffff"
                  className="flex-1"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="bg-dark">Background Color (Dark Mode)</Label>
              <div className="flex gap-2 items-center mt-2">
                <Input
                  id="bg-dark"
                  type="color"
                  value={splashBgDark}
                  onChange={(e) => setSplashBgDark(e.target.value)}
                  disabled={uploading}
                  className="w-20 h-9 cursor-pointer"
                />
                <Input
                  type="text"
                  value={splashBgDark}
                  onChange={(e) => setSplashBgDark(e.target.value)}
                  disabled={uploading}
                  placeholder="#000000"
                  className="flex-1"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex-1">
          {uploading && status && (
            <p className="text-sm text-muted-foreground">
              <Loader2 className="inline w-4 h-4 animate-spin mr-2" />
              {status}
            </p>
          )}
        </div>
        <Button onClick={handleUpload} disabled={!lightFile || uploading}>
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Processing...
            </>
          ) : (
            `Generate & Deploy ${typeLabel}`
          )}
        </Button>
      </div>
    </div>
  );
}
