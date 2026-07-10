import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

// Origins the packaged Capacitor app's WebView sends in the Origin header.
// Server-fn requests from the app are cross-origin, so the server must answer
// CORS preflights and mark responses as readable for these origins.
const APP_WEBVIEW_ORIGINS = new Set([
  "capacitor://localhost", // iOS
  "https://localhost", // Android (default androidScheme)
  "http://localhost", // Android (androidScheme: http)
]);

export const corsMiddleware = createMiddleware().server(async ({ next }) => {
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
