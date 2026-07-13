import * as React from "react";
import { useSidebar } from "@/components/ui/sidebar";

const EDGE_WIDTH = 28;
const OPEN_DISTANCE = 45;

/**
 * Opens the mobile sidebar sheet when the user swipes right starting from
 * the left edge of the screen. Renders nothing; must live inside a
 * SidebarProvider.
 */
export function SidebarEdgeSwipe() {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();

  React.useEffect(() => {
    if (!isMobile || openMobile) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      tracking = t.clientX <= EDGE_WIDTH;
      startX = t.clientX;
      startY = t.clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (dy > dx * 1.5) {
        // Mostly vertical: it's a scroll, not an edge swipe
        tracking = false;
        return;
      }
      if (dx >= OPEN_DISTANCE) {
        tracking = false;
        setOpenMobile(true);
      }
    };

    const onTouchEnd = () => {
      tracking = false;
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [isMobile, openMobile, setOpenMobile]);

  return null;
}
