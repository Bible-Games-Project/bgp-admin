import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Outlet, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarEdgeSwipe } from "@/components/SidebarEdgeSwipe";
import { PullToRefresh } from "@/components/PullToRefresh";
import { checkAccessGate } from "@/lib/auth-gate";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const result = await checkAccessGate();
    if ("redirect" in result) {
      throw redirect({ to: result.redirect });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(true);

  const handleRefresh = useCallback(async () => {
    await Promise.all([router.invalidate(), queryClient.refetchQueries({ type: "active" })]);
  }, [router, queryClient]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      // Only react to explicit sign-out. INITIAL_SESSION with a null session
      // can fire before storage hydration completes and cause a login<->dashboard
      // ping-pong. beforeLoad/checkAccessGate is the source of truth for auth.
      if (event === "SIGNED_OUT") {
        queryClient.cancelQueries();
        queryClient.clear();
        navigate({ to: "/login", replace: true });
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate, queryClient]);

  if (!ready) return null;

  return (
    <SidebarProvider>
      <SidebarEdgeSwipe />
      {/* Fixed viewport height (not min-h) so <main> is the only scroller;
          pull-to-refresh relies on its scrollTop to know it's at the top */}
      <div className="h-dvh overflow-hidden flex w-full bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {/* box-content: keep 3rem of content height, safe-area padding on top */}
          <header className="h-12 box-content pt-[env(safe-area-inset-top)] border-b border-border flex items-center px-3 gap-2">
            <SidebarTrigger />
            <span className="label-mono">bgp · deploy console</span>
          </header>
          <PullToRefresh
            onRefresh={handleRefresh}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
          >
            <Outlet />
          </PullToRefresh>
        </div>
      </div>
    </SidebarProvider>
  );
}
