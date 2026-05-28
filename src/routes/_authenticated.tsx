import { useEffect, useState } from "react";
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
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
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) {
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
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 border-b border-border flex items-center px-3 gap-2">
            <SidebarTrigger />
            <span className="label-mono">bgp · deploy console</span>
          </header>
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
