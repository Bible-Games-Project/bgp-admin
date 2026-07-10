import { createStart, createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";
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

// --- Capacitor app support ---------------------------------------------------
// The console also ships as a native Capacitor app (see capacitor.config.ts).
// There the bundle is served from capacitor://localhost (iOS) or
// https://localhost (Android), where no TanStack Start server exists, so
// server-function RPCs must target the deployed console instead. Set
// VITE_APP_SERVER_ORIGIN (e.g. "https://bgp-admin.example.com") when building
// the app bundle; the web build is unaffected because the rewrite only kicks
// in inside a native WebView.

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

// Origins the packaged app's WebView sends in the Origin header. Server-fn
// requests from the app are cross-origin, so the server must answer CORS
// preflights and mark responses as readable for these origins.
const APP_WEBVIEW_ORIGINS = new Set([
  "capacitor://localhost", // iOS
  "https://localhost", // Android (default androidScheme)
  "http://localhost", // Android (androidScheme: http)
]);

const corsMiddleware = createMiddleware().server(async ({ next }) => {
  const request = getRequest();
  const origin = request?.headers.get("origin");
  if (!origin || !APP_WEBVIEW_ORIGINS.has(origin)) {
    return next();
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers":
          request.headers.get("access-control-request-headers") ??
          "authorization,content-type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }

  const ctx = await next();
  const response = (ctx as { response?: unknown }).response;
  if (response instanceof Response) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Expose-Headers", "*");
    response.headers.append("Vary", "Origin");
  }
  return ctx;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [corsMiddleware, errorMiddleware],
  functionMiddleware: [attachSupabaseAuth],
  serverFns: { fetch: serverFnFetch },
}));
