// Usage events for the admin panel. Each event is a blob whose KEY carries the
// data (ev:<yyyymmdd>:<ms>:<rand>:<user>:<action>:<detail>), so listing keys by
// day prefix gives the full log without reading any values.
import { createHash } from "node:crypto";
import { openStore } from "./store.mjs";

const clean = (s) => String(s ?? "").replace(/[^A-Za-z0-9_.\-]/g, "_").slice(0, 40);

/** True when the request comes from a browser that has logged in as admin (developer traffic). */
export function isDevRequest(req) {
  const cookie = req && req.headers && req.headers.get ? req.headers.get("cookie") || "" : "";
  return /(^|;\s*)kz_dev=1(;|$)/.test(cookie);
}

export const DEV_COOKIE = "kz_dev=1; Path=/; Max-Age=31536000; SameSite=Lax";

/** Country code, region and city from Netlify's geolocation (context.geo or the x-nf-geo header). */
export function geoOf(req) {
  let g = req && req.nfGeo;
  if (!g && req && req.headers && req.headers.get) {
    const h = req.headers.get("x-nf-geo");
    if (h) { try { g = JSON.parse(Buffer.from(h, "base64").toString("utf8")); } catch {} }
  }
  if (!g) return { country: "ZZ", countryName: null, region: null, city: null, timezone: null, lat: null, lon: null };
  return { country: (g.country && g.country.code) || "ZZ", countryName: (g.country && g.country.name) || null, region: (g.subdivision && (g.subdivision.name || g.subdivision.code)) || null, city: g.city || null, timezone: g.timezone || null, lat: g.latitude ?? null, lon: g.longitude ?? null };
}

/** Stable anonymous visitor id: a salted hash of the client IP, never the IP itself. */
export function visitorId(req) {
  try {
    const ip = (req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "").trim();
    if (!ip) return "anon";
    return "v_" + createHash("sha256").update(`${process.env.AUTH_SECRET || "kz"}|${ip}`).digest("hex").slice(0, 8);
  } catch { return "anon"; }
}

export async function logEvent(action, { user, detail, req } = {}) {
  try {
    if ((user && user.role === "admin") || isDevRequest(req)) return; // developer traffic is never recorded
    const store = await openStore("events");
    const now = new Date();
    const day = now.toISOString().slice(0, 10).replace(/-/g, "");
    const geo = geoOf(req);
    const who = user ? user.username : (req ? visitorId(req) : "anon");
    const place = clean(`${geo.region || ""}~${geo.city || ""}`);
    const key = `ev:${day}:${now.getTime()}:${Math.random().toString(36).slice(2, 6)}:${clean(who)}:${clean(action)}:${clean(detail)}:${clean(geo.country)}:${place}`;
    const ua = req && req.headers && req.headers.get ? String(req.headers.get("user-agent") || "").slice(0, 160) : "";
    const value = { geo, ua, lang: req && req.headers && req.headers.get ? String(req.headers.get("accept-language") || "").slice(0, 40) : "", ref: req && req.headers && req.headers.get ? String(req.headers.get("referer") || "").slice(0, 200) : "", visitor: req ? visitorId(req) : null };
    await store.set(key, value);
  } catch (e) {
    console.warn("logEvent failed", e.message);
  }
}

function parseKey(k) {
  const [, day, ms, , user, action, detail, country = "ZZ", place = ""] = k.split(":");
  const [region = "", city = ""] = place.split("~");
  return { key: k, day: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`, ts: Number(ms), user, action, detail, country: country || "ZZ", region: region.replace(/_/g, " ") || null, city: city.replace(/_/g, " ") || null, anon: !user || user === "anon" || user.startsWith("v_") };
}

/** Events for the last `days` days (newest first); location comes from the key, so no values are read. */
export async function listEvents(days = 14) {
  const store = await openStore("events");
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
    const keys = await store.list(`ev:${d}:`);
    for (const k of keys) out.push(parseKey(k));
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/** Stored details (user agent, timezone, coordinates, referrer) for a bounded set of events. */
export async function eventDetails(events, limit = 300) {
  const store = await openStore("events");
  const out = [];
  for (const e of events.slice(0, limit)) { const v = await store.get(e.key).catch(() => null); out.push({ ...e, ...(v && typeof v === "object" ? { ua: v.ua, lang: v.lang, ref: v.ref, timezone: v.geo && v.geo.timezone, lat: v.geo && v.geo.lat, lon: v.geo && v.geo.lon, countryName: v.geo && v.geo.countryName } : {}) }); }
  return out;
}
