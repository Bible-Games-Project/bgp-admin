// Browser-only: draws a store screenshot from Claude's design (store-screenshots.ts) and a
// real capture of the game, at the slot's exact size. What the person sees in the preview
// is exactly what gets uploaded.
import {
  captionPieces,
  isRightToLeft,
  screenshotLayout,
  type ScreenshotDesign,
  type ScreenshotFont,
  type Rect,
} from "@/lib/store-screenshots";

const FONTS: Record<ScreenshotFont, { family: string; weight: number }> = {
  rounded: {
    family: '"Arial Rounded MT Bold", "Nunito", ui-rounded, "Varela Round", system-ui, sans-serif',
    weight: 800,
  },
  bold: { family: '"Avenir Next", "Helvetica Neue", Arial, system-ui, sans-serif', weight: 800 },
  serif: { family: 'Georgia, "Times New Roman", serif', weight: 700 },
  playful: { family: '"Chalkboard SE", "Comic Sans MS", "Marker Felt", cursive', weight: 700 },
};

export function loadCapture(file: File): Promise<{ image: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} isn't an image this browser can read.`));
    };
    image.src = url;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
}

/** A tiny deterministic random, so a screenshot looks the same every time it's drawn. */
function seeded(seed: number) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function drawDecor(
  ctx: CanvasRenderingContext2D,
  design: ScreenshotDesign,
  width: number,
  height: number,
  index: number,
) {
  if (design.decor === "none") return;
  const rand = seeded(index + 1);
  const short = Math.min(width, height);
  ctx.save();
  ctx.fillStyle = design.accentColor;
  if (design.decor === "bubbles") {
    for (let i = 0; i < 9; i++) {
      ctx.globalAlpha = 0.12 + rand() * 0.15;
      ctx.beginPath();
      ctx.arc(rand() * width, rand() * height, short * (0.04 + rand() * 0.14), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (design.decor === "stars") {
    for (let i = 0; i < 22; i++) {
      ctx.globalAlpha = 0.35 + rand() * 0.5;
      const cx = rand() * width;
      const cy = rand() * height;
      const r = short * (0.006 + rand() * 0.018);
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const radius = k % 2 === 0 ? r : r * 0.45;
        const a = (Math.PI / 5) * k - Math.PI / 2;
        ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      }
      ctx.closePath();
      ctx.fill();
    }
  } else if (design.decor === "rays") {
    const cx = width / 2;
    const cy = design.captionPosition === "top" ? height * 0.6 : height * 0.4;
    const reach = Math.hypot(width, height);
    ctx.globalAlpha = 0.1;
    for (let k = 0; k < 16; k++) {
      const a = (Math.PI * 2 * k) / 16;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * reach, cy + Math.sin(a) * reach);
      ctx.lineTo(cx + Math.cos(a + 0.12) * reach, cy + Math.sin(a + 0.12) * reach);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Splits the caption into lines that fit `maxWidth`, at most `maxLines`. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const piece of captionPieces(text)) {
    const tryLine = line ? `${line}${piece.join}${piece.text}` : piece.text;
    if (ctx.measureText(tryLine).width <= maxWidth || !line) line = tryLine;
    else {
      lines.push(line);
      line = piece.text;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  design: ScreenshotDesign,
  text: string,
  box: Rect,
) {
  if (!text.trim()) return;
  const font = FONTS[design.font];
  // The biggest size at which the text (at most three lines) and the accent bar fit
  // inside the band, so neither touches the phone.
  const extra = (s: number) => s * 0.25 + Math.max(4, s * 0.16);
  let size = Math.round(box.h * 0.36);
  let lines: string[] = [];
  for (; size > 12; size -= 2) {
    ctx.font = `${font.weight} ${size}px ${font.family}`;
    lines = wrap(ctx, text, box.w);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (lines.length <= 3 && lines.length * size * 1.15 + extra(size) <= box.h && widest <= box.w)
      break;
  }
  const lineH = size * 1.15;
  const block = lines.length * lineH + extra(size);
  const blockTop = box.y + (box.h - block) / 2;
  // The bar sits on the side away from the phone.
  const top = design.captionPosition === "top" ? blockTop : blockTop + extra(size);
  ctx.save();
  ctx.direction = isRightToLeft(text) ? "rtl" : "ltr";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = design.textColor;
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = size * 0.15;
  ctx.shadowOffsetY = size * 0.05;
  lines.forEach((l, i) => ctx.fillText(l, box.x + box.w / 2, top + lineH * (i + 0.5)));
  ctx.restore();
  // A short accent bar under (or, at the bottom, over) the caption.
  const bar: Rect = {
    x: box.x + box.w / 2 - size * 0.9,
    y: design.captionPosition === "top" ? top + lines.length * lineH + size * 0.25 : blockTop,
    w: size * 1.8,
    h: Math.max(4, size * 0.16),
  };
  ctx.save();
  ctx.fillStyle = design.accentColor;
  roundRect(ctx, bar, bar.h / 2);
  ctx.fill();
  ctx.restore();
}

/** Draws one screenshot onto a new canvas. */
export function drawScreenshot(
  design: ScreenshotDesign,
  caption: string,
  capture: HTMLImageElement,
  width: number,
  height: number,
  index: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The browser could not draw the screenshot.");

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, design.background[0]);
  bg.addColorStop(1, design.background[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  drawDecor(ctx, design, width, height, index);

  const layout = screenshotLayout(
    width,
    height,
    capture.naturalWidth,
    capture.naturalHeight,
    design,
  );

  // The phone (or the bare capture) with its shadow.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = Math.min(width, height) * 0.04;
  ctx.shadowOffsetY = Math.min(width, height) * 0.015;
  ctx.fillStyle =
    design.frame === "phone-light" ? "#F4F4F6" : design.frame === "phone-dark" ? "#16161A" : "#000";
  roundRect(ctx, layout.device, layout.deviceRadius);
  ctx.fill();
  ctx.restore();
  if (design.frame !== "none") {
    ctx.save();
    ctx.strokeStyle = design.frame === "phone-light" ? "#C9C9CF" : "#3A3A42";
    ctx.lineWidth = Math.max(2, layout.device.w * 0.006);
    roundRect(ctx, layout.device, layout.deviceRadius);
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  roundRect(ctx, layout.screen, layout.screenRadius);
  ctx.clip();
  ctx.drawImage(capture, layout.screen.x, layout.screen.y, layout.screen.w, layout.screen.h);
  ctx.restore();

  drawCaption(ctx, design, caption, layout.caption);
  return canvas;
}

/** The screenshot as a PNG file, ready for the usual upload. */
export function screenshotFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("The browser could not encode the screenshot."));
      resolve(new File([blob], name, { type: "image/png" }));
    }, "image/png"),
  );
}
