import * as React from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const PULL_THRESHOLD = 70;
const MAX_PULL = 110;
const RESISTANCE = 0.5;
const SETTLE_PULL = 56;
// Dead zone before the pull engages, so taps and scroll-stop touches at the
// top of the page don't accidentally start a refresh gesture
const START_SLOP = 12;

/**
 * Scroll container with touch pull-to-refresh. When the content is scrolled
 * to the top and the user drags down past the threshold, `onRefresh` runs and
 * the spinner stays visible until it resolves. Mouse/desktop is unaffected.
 */
export function PullToRefresh({
  onRefresh,
  className,
  children,
}: {
  onRefresh: () => Promise<unknown>;
  className?: string;
  children: React.ReactNode;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const indicatorRef = React.useRef<HTMLDivElement>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const refreshingRef = React.useRef(false);

  React.useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    const indicator = indicatorRef.current;
    if (!scroller || !content || !indicator) return;

    let startX = 0;
    let startY = 0;
    let pull = 0;
    let tracking = false;

    const setPull = (px: number, animate: boolean) => {
      const transition = animate ? "transform 0.2s ease" : "none";
      content.style.transition = transition;
      indicator.style.transition = animate ? "transform 0.2s ease, opacity 0.2s ease" : "none";
      content.style.transform = px > 0 ? `translateY(${px}px)` : "";
      indicator.style.transform = px > 0 ? `translateY(${px}px)` : "";
      indicator.style.opacity = px > 0 ? String(Math.min(px / PULL_THRESHOLD, 1)) : "0";
      const icon = indicator.firstElementChild as HTMLElement | null;
      if (icon && !refreshingRef.current) {
        // Wind up the arrow while pulling so the gesture feels connected
        icon.style.transform = `rotate(${(px / PULL_THRESHOLD) * 270}deg)`;
      } else if (icon) {
        icon.style.transform = "";
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current || scroller.scrollTop > 0) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      pull = 0;
      tracking = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || refreshingRef.current) return;
      const dx = Math.abs(e.touches[0].clientX - startX);
      const dy = e.touches[0].clientY - startY;
      if (pull === 0 && dx > Math.abs(dy)) {
        // Mostly horizontal: leave it to other gestures (e.g. edge swipe)
        tracking = false;
        return;
      }
      if (dy <= START_SLOP || scroller.scrollTop > 0) {
        if (pull > 0) setPull(0, false);
        pull = 0;
        return;
      }
      e.preventDefault();
      pull = Math.min((dy - START_SLOP) * RESISTANCE, MAX_PULL);
      setPull(pull, false);
    };

    const onTouchEnd = async () => {
      if (!tracking) return;
      tracking = false;
      if (pull >= PULL_THRESHOLD && !refreshingRef.current) {
        refreshingRef.current = true;
        setRefreshing(true);
        setPull(SETTLE_PULL, true);
        try {
          await onRefresh();
        } finally {
          refreshingRef.current = false;
          setRefreshing(false);
          setPull(0, true);
        }
      } else if (pull > 0) {
        setPull(0, true);
      }
      pull = 0;
    };

    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("touchend", onTouchEnd);
    scroller.addEventListener("touchcancel", onTouchEnd);
    return () => {
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [onRefresh]);

  return (
    <div ref={scrollRef} className={cn("relative overscroll-y-none", className)}>
      <div
        ref={indicatorRef}
        className="pointer-events-none absolute inset-x-0 top-0 z-10 -mt-10 flex h-10 items-center justify-center opacity-0"
      >
        <RefreshCw className={cn("size-5 text-muted-foreground", refreshing && "animate-spin")} />
      </div>
      {/* Bottom inset lives on the content so the last items clear the home indicator */}
      <div ref={contentRef} className="pb-[env(safe-area-inset-bottom)]">
        {children}
      </div>
    </div>
  );
}
