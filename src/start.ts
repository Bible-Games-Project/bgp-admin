import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { corsMiddleware } from "./lib/cors-middleware";
import { attachSupabaseAuth } from "./integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// The console also ships as a native Capacitor app (see capacitor.config.ts).
// There the bundle is served from capacitor://localhost (iOS) or
// https://localhost (Android), where no TanStack Start server exists, so
// server-function RPCs must target the deployed console instead. Set
// VITE_APP_SERVER_ORIGIN (e.g. "https://bgp-admin.lovable.app") when building
// the app bundle; the web build is unaffected because the rewrite only kicks
// in inside a native WebView. The server side of this lives in
// lib/cors-middleware.ts.

const APP_SERVER_ORIGIN: string | undefined = import.meta.env.VITE_APP_SERVER_ORIGIN;

function isNativeApp(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as any).Capacitor?.isNativePlatform?.()
  );
}

const serverFnFetch: typeof fetch = (input, init) => {
  if (
    APP_SERVER_ORIGIN &&
    typeof input === "string" &&
    input.startsWith("/") &&
    isNativeApp()
  ) {
    return fetch(new URL(input, APP_SERVER_ORIGIN).toString(), init);
  }
  return fetch(input, init);
};

export const startInstance = createStart(() => ({
  requestMiddleware: [corsMiddleware, errorMiddleware],
  functionMiddleware: [attachSupabaseAuth],
  serverFns: { fetch: serverFnFetch },
}));
