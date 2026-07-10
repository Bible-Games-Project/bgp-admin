// redeploy trigger 2026-06-02
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { routeTree } from "./routeTree.gen";

// Shown while beforeLoad guards (auth gate) are resolving. Without this the
// router renders nothing during navigation, which in the Capacitor app means
// a solid-background blank screen.
function PendingComponent() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <span className="label-mono text-xs text-muted-foreground">Loading…</span>
    </div>
  );
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: PendingComponent,
    defaultPendingMs: 300,
    defaultPendingMinMs: 300,
  });

  return router;
};
