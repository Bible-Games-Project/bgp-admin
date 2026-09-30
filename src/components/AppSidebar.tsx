import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LogOut,
  Terminal,
  ShieldCheck,
  Boxes,
  DollarSign,
  Receipt,
  Star,
  House,
  Bell,
  Download,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";

const items = [
  { title: "Home", url: "/", icon: House },
  { title: "Apps", url: "/apps", icon: Boxes },
  { title: "Revenue", url: "/revenue", icon: DollarSign },
  { title: "Downloads", url: "/downloads", icon: Download },
  { title: "Expenses", url: "/expenses", icon: Receipt },
  { title: "Reviews", url: "/reviews", icon: Star },
  { title: "Notifications", url: "/settings/notifications", icon: Bell },
  { title: "Security", url: "/settings/security", icon: ShieldCheck },
];

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border h-12 flex flex-row items-center px-3 gap-2">
        <Terminal className="h-4 w-4 text-primary shrink-0" />
        {!collapsed && (
          <span className="font-display font-semibold tracking-tight text-sm text-sidebar-foreground">
            bgp / console
          </span>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="label-mono">Workflows</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url || pathname.startsWith(item.url + "/")}
                  >
                    <Link
                      to={item.url}
                      className="flex items-center gap-2"
                      onClick={closeMobileSidebar}
                    >
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={async () => {
                // SPA navigation instead of window.location.href: a full page
                // load of /login 404s inside the Capacitor app, where only
                // index.html exists in the bundle.
                await supabase.auth.signOut();
                navigate({ to: "/login", replace: true });
              }}
            >
              <LogOut className="h-4 w-4" />
              {!collapsed && <span>Sign out</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
