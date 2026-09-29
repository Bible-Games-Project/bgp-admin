// Browser-only: reads a picked image and prepares the bytes a store will accept.

export type PreparedImage = {
  width: number;
  height: number;
  base64: string;
  contentType: "image/png" | "image/jpeg";
  fileName: string;
  /** Object URL for the preview; revoke it when the image is dropped. */
  previewUrl: string;
};

// Both stores cap uploads around here, and the bytes travel base64 through a server
// function, so anything bigger is re-encoded as a JPEG.
const MAX_BYTES = 8 * 1024 * 1024;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file isn't an image this browser can read."));
    img.src = url;
  });
}

export async function readImageSize(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const pixels = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) return true;
  return false;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("The browser could not encode the image."))),
      type,
      quality,
    ),
  );
}

/**
 * Keeps the original file whenever the store takes it as is. Otherwise re-encodes:
 * - `keepPng` (Play's icon): always a PNG, transparency allowed.
 * - everything else: a transparent PNG, or one over the size cap, becomes a JPEG on
 *   white, since screenshots and feature graphics can't carry an alpha channel.
 */
export async function prepareStoreImage(
  file: File,
  { keepPng = false }: { keepPng?: boolean } = {},
): Promise<PreparedImage> {
  if (!/^image\/(png|jpeg)$/.test(file.type)) {
    throw new Error(`${file.name}: only PNG and JPEG images are accepted.`);
  }
  const previewUrl = URL.createObjectURL(file);
  const img = await loadImage(previewUrl);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-") || "image";

  const original = async (contentType: "image/png" | "image/jpeg") => ({
    width,
    height,
    previewUrl,
    contentType,
    fileName: `${base}.${contentType === "image/png" ? "png" : "jpg"}`,
    base64: toBase64(new Uint8Array(await file.arrayBuffer())),
  });

  if (keepPng && file.type === "image/png" && file.size <= MAX_BYTES) return original("image/png");
  if (!keepPng && file.type === "image/jpeg" && file.size <= MAX_BYTES) {
    return original("image/jpeg");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("The browser could not prepare the image.");

  if (keepPng) {
    ctx.drawImage(img, 0, 0);
    const blob = await canvasBlob(canvas, "image/png");
    return {
      width,
      height,
      previewUrl,
      contentType: "image/png",
      fileName: `${base}.png`,
      base64: toBase64(new Uint8Array(await blob.arrayBuffer())),
    };
  }

  ctx.drawImage(img, 0, 0);
  if (file.type === "image/png" && file.size <= MAX_BYTES && !hasTransparency(ctx, width, height)) {
    return original("image/png");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0);
  let blob = await canvasBlob(canvas, "image/jpeg", 0.92);
  if (blob.size > MAX_BYTES) blob = await canvasBlob(canvas, "image/jpeg", 0.8);
  return {
    width,
    height,
    previewUrl,
    contentType: "image/jpeg",
    fileName: `${base}.jpg`,
    base64: toBase64(new Uint8Array(await blob.arrayBuffer())),
  };
}
