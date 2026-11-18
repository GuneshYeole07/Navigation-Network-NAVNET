import { env } from "../config/env.js";

/**
 * CLIENT_ORIGIN accepts exact origins and wildcards, comma-separated:
 *   CLIENT_ORIGIN=https://navnet.onrender.com,https://*.trycloudflare.com
 */
// The installed Android / iOS app (Capacitor) loads the UI from these origins.
const APP_ORIGINS = ["https://localhost", "capacitor://localhost"];

export function isAllowedOrigin(origin, list = env.clientOrigins) {
  if (!origin || APP_ORIGINS.includes(origin)) return true;
  return list.some((rule) => {
    if (rule === "*") return true;
    if (!rule.includes("*")) return rule === origin;
    const [scheme, host] = rule.split("://");
    if (!origin.startsWith(`${scheme}://`)) return false;
    const suffix = host.replace(/^\*\./, ".");
    return new URL(origin).host.endsWith(suffix);
  });
}

/** Same-origin requests (app served by this server or through a dev proxy) are always fine. */
export function isSameOrigin(origin, host) {
  try {
    return !!origin && !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}
