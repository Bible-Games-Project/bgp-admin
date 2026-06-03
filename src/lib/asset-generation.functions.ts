import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
}

async function loadApp(supabase: any, appId: string) {
  const { data, error } = await supabase
    .from("apps")
    .select("*")
    .eq("id", appId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("App not found");
  return data;
}

function githubHeaders() {
  const token = process.env.GITHUB_PAT;
  if (!token) throw new Error("GITHUB_PAT not configured");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "bgp-admin-assets",
  };
}

/**
 * Upload asset files to GitHub repository and trigger the asset generation workflow.
 * This function uses the GitHub Contents API to upload files directly, which works
 * in Cloudflare Workers runtime (unlike git clone + simple-git).
 */
export const uploadAndGenerateAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        type: z.enum(["icon", "splash"]),
        imageData: z.instanceof(Uint8Array),
        imageDarkData: z.instanceof(Uint8Array).optional(),
        splashBgColor: z.string().optional(),
        splashBgColorDark: z.string().optional(),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    // Verify admin permissions
    await assertAdmin(context.supabase, context.userId);

    // Load app data
    const app = await loadApp(context.supabase, data.appId);

    // Validate image data
    if (data.imageData.length > 5 * 1024 * 1024) {
      throw new Error("Image size must be less than 5MB");
    }
    if (data.imageDarkData && data.imageDarkData.length > 5 * 1024 * 1024) {
      throw new Error("Dark mode image size must be less than 5MB");
    }

    const owner = app.github_owner;
    const repo = app.github_repo;
    const branch = app.default_ref || "main";

    try {
      // Helper to convert Uint8Array to base64 safely (without stack overflow)
      const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      };

      // Helper to upload a file via GitHub Contents API
      const uploadFile = async (path: string, content: Uint8Array) => {
        // First, try to get the existing file to obtain its SHA (required for updates)
        const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
        const getRes = await fetch(getUrl, { headers: githubHeaders() });
        
        let sha: string | undefined;
        if (getRes.ok) {
          const existing = await getRes.json() as any;
          sha = existing.sha;
        }

        // Convert Uint8Array to base64 safely
        const base64 = uint8ArrayToBase64(content);

        // Upload or update the file
        const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
        const putBody = {
          message: `chore: update ${path} via bgp-admin`,
          content: base64,
          branch,
          ...(sha && { sha }),
        };

        const putRes = await fetch(putUrl, {
          method: "PUT",
          headers: githubHeaders(),
          body: JSON.stringify(putBody),
        });

        if (!putRes.ok) {
          const errorText = await putRes.text();
          throw new Error(`Failed to upload ${path}: ${putRes.status} ${errorText}`);
        }

        // Don't return the full response - just success
        await putRes.json();
        return true;
      };

      // Upload light mode image
      const lightFileName = data.type === "icon" ? "logo.png" : "splash.png";
      console.log(`Uploading ${lightFileName} to assets/...`);
      await uploadFile(`assets/${lightFileName}`, data.imageData);

      // Upload dark mode image if provided
      if (data.imageDarkData) {
        const darkFileName = data.type === "icon" ? "logo-dark.png" : "splash-dark.png";
        console.log(`Uploading ${darkFileName} to assets/...`);
        await uploadFile(`assets/${darkFileName}`, data.imageDarkData);
      }

      // Upload or update assets configuration file with colors
      const configContent = JSON.stringify({
        iconBackgroundColor: "#ffffff",
        splashBackgroundColor: data.splashBgColor || "#ffffff",
        splashBackgroundColorDark: data.splashBgColorDark || "#000000",
      }, null, 2);
      
      const configBytes = new TextEncoder().encode(configContent);
      console.log("Uploading assets configuration...");
      await uploadFile("assets/config.json", configBytes);

      // Trigger the GitHub Action workflow to generate all asset sizes
      console.log("Triggering asset generation workflow...");
      const workflowUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/generate-assets.yml/dispatches`;
      const workflowRes = await fetch(workflowUrl, {
        method: "POST",
        headers: githubHeaders(),
        body: JSON.stringify({
          ref: branch,
          inputs: {
            asset_type: data.type,
          },
        }),
      });

      if (!workflowRes.ok) {
        const errorText = await workflowRes.text();
        console.warn(`Failed to trigger workflow: ${workflowRes.status} ${errorText}`);
        // Don't throw - files are uploaded, workflow can be triggered manually
      }

      const assetType = data.type === "icon" ? "app icon" : "splash screen";
      
      // Cache icon as base64 data URL on apps row for fast list rendering.
      // Only for icons, and only when payload is small enough (<= 500KB raw).
      if (data.type === "icon" && data.imageData.length <= 500 * 1024) {
        const base64 = uint8ArrayToBase64(data.imageData);
        const dataUrl = `data:image/png;base64,${base64}`;
        const { error: updErr } = await context.supabase
          .from("apps")
          .update({ icon_data_url: dataUrl })
          .eq("id", data.appId);
        if (updErr) {
          console.error("Failed to cache icon_data_url:", updErr.message);
        }
      }

      return {
        success: true,
        commitUrl: `https://github.com/${owner}/${repo}/tree/${branch}/assets`,
        message: `${assetType.charAt(0).toUpperCase() + assetType.slice(1)} uploaded successfully. Asset generation workflow has been triggered.`,
      };
    } catch (error) {
      console.error("Asset upload failed:", error);
      throw error instanceof Error ? error : new Error("Asset upload failed");
    }
  });
