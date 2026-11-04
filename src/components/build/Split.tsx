import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";

// The line between the chat and the preview on a wide screen: drag it to give either side
// more room (or use the arrow keys on it; double-click puts it back). The width is kept in
// the browser, so the page opens as it was left.

const KEY = "bgp-build-chat-width";
export const CHAT_WIDTH_DEFAULT = 460;
export const CHAT_WIDTH_MIN = 320;
/** The preview keeps at least this much. */
const PREVIEW_MIN = 280;
const KEY_STEP = 32;

export function useChatWidth() {
  const [width, setWidth] = useState(CHAT_WIDTH_DEFAULT);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (saved >= CHAT_WIDTH_MIN) setWidth(saved);
    } catch {
      // Storage can be off (a private window); the default is fine.
    }
  }, []);
  const set = useCallback((next: number) => {
    const value = Math.round(next);
    setWidth(value);
    try {
      localStorage.setItem(KEY, String(value));
    } catch {
      // Same.
    }
  }, []);
  return [width, set] as const;
}

/** Within what the window leaves room for. */
export function clampChatWidth(width: number, containerWidth: number) {
  const max = Math.max(CHAT_WIDTH_MIN, containerWidth - PREVIEW_MIN);
  return Math.min(Math.max(width, CHAT_WIDTH_MIN), max);
}

export function SplitHandle({
  width,
  containerRef,
  onChange,
  onDragging,
}: {
  width: number;
  containerRef: RefObject<HTMLElement | null>;
  onChange: (width: number) => void;
  /** While dragging, the preview's iframe must not take the pointer. */
  onDragging: (dragging: boolean) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const limit = (next: number) =>
    clampChatWidth(next, containerRef.current?.clientWidth ?? Number.POSITIVE_INFINITY);
  const begin = (on: boolean) => {
    setDragging(on);
    onDragging(on);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the chat"
      aria-valuenow={width}
      aria-valuemin={CHAT_WIDTH_MIN}
      tabIndex={0}
      title="Drag to resize. Double-click to put it back."
      className="hidden md:flex relative z-10 w-1.5 shrink-0 cursor-col-resize items-stretch justify-center group touch-none select-none outline-none after:absolute after:inset-y-0 after:-left-1.5 after:-right-1.5"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width };
        begin(true);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        onChange(limit(drag.current.width + e.clientX - drag.current.x));
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        begin(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        begin(false);
      }}
      onDoubleClick={() => onChange(CHAT_WIDTH_DEFAULT)}
      onKeyDown={(e) => {
        const steps: Record<string, number> = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP };
        if (e.key in steps) {
          e.preventDefault();
          onChange(limit(width + steps[e.key]));
        } else if (e.key === "Home") {
          e.preventDefault();
          onChange(CHAT_WIDTH_MIN);
        } else if (e.key === "End") {
          e.preventDefault();
          onChange(limit(Number.POSITIVE_INFINITY));
        }
      }}
    >
      <div
        className={cn(
          "w-px bg-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary",
          dragging && "bg-primary",
        )}
      />
    </div>
  );
}
