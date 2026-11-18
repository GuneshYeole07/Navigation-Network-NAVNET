#!/usr/bin/env node
/**
 * Diagnose the open-source map services from THIS machine.
 *   npm run check:geo
 * Prints OK/FAIL with the real reason (blocked, timed out, DNS, TLS…) for each provider.
 */
import { env } from "../src/config/env.js";
import { describeError } from "../src/services/routing.service.js";

const UA = { "User-Agent": env.geoUserAgent, "Accept-Language": "en" };
const checks = [
  ["Nominatim search", `${env.nominatimUrl}/search?format=jsonv2&limit=1&q=Lonavala`, (d) => d.length > 0],
  ["Photon search (fallback)", `${env.photonUrl}/api/?limit=1&q=Lonavala`, (d) => d.features?.length > 0],
  ["OSRM routing", `${env.osrmUrl}/route/v1/driving/73.8475,18.5308;73.4062,18.7546?overview=false`, (d) => d.code === "Ok"],
  ["OpenStreetMap tiles", "https://tile.openstreetmap.org/10/721/459.png", null],
];
if (env.orsApiKey) checks.push(["OpenRouteService", "https://api.openrouteservice.org/v2/directions/driving-car?start=73.8475,18.5308&end=73.4062,18.7546", (d) => !!d.features, { Authorization: env.orsApiKey }]);

console.log(`User-Agent: ${env.geoUserAgent}\n`);
let failed = 0;
for (const [name, url, ok, extra] of checks) {
  const t = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { headers: { ...UA, ...extra }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    if (ok && !ok(await res.json())) throw new Error("unexpected response");
    console.log(`  OK    ${name}  (${Date.now() - t} ms)`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}  → ${describeError(err)}`);
  }
}
console.log(failed ? `\n${failed} service(s) unreachable from this machine.` : "\nAll map services reachable.");
process.exit(failed ? 1 : 0);
