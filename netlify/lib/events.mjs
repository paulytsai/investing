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

// Crawlers, headless browsers and scripted clients. Their events are recorded (so the crawl is
// visible) but keyed as b_<name> instead of v_<hash>, so every usage figure can skip them from the key alone.
const BOT_UA = /bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|python|curl\/|wget|node-fetch|undici|go-http|java\/|libwww|httpclient|scrapy|facebookexternalhit|bingpreview|petal|semrush|ahrefs|mj12|yandex|baidu|duckduck|applebot|archive\.org|anthropic|openai|perplexity|bytespider|dataforseo/i;
export const isBotUa = (ua) => !ua || BOT_UA.test(String(ua));
/** Short bot name from a user agent: "claudebot", "googlebot", "headlesschrome", "curl"... */
export function botName(ua) {
  const s = String(ua || "");
  if (!s) return "no-agent";
  const m = s.match(/([A-Za-z]+bot)(?![A-Za-z])/i) || s.match(/(HeadlessChrome|Puppeteer|Playwright|python-requests|python|curl|wget|node-fetch|undici|Go-http-client|Scrapy|facebookexternalhit|bingpreview|PetalBot|SemrushBot|AhrefsBot|MJ12bot|Bytespider|crawler|spider)/i);
  return (m ? m[1] : "other").toLowerCase().replace(/[^a-z0-9]/g, "");
}
/** Throwaway accounts created while testing the site; their traffic is not usage. */
export const isTestUser = (name) => /^(qtv|t30chk|cptest|stripetest)/i.test(String(name || ""));
/** A person (not a crawler, a script or a test account). */
export const isHuman = (e) => !e.bot && !e.test && !e.system;

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
    const ua = req && req.headers && req.headers.get ? String(req.headers.get("user-agent") || "").slice(0, 160) : "";
    const bot = !!req && !user && isBotUa(ua);
    const who = user ? user.username : bot ? `b_${botName(ua)}` : (req ? visitorId(req) : "anon");
    const place = `${clean(geo.region || "")}~${clean(geo.city || "")}`; // "~" separates region and city inside the key
    const key = `ev:${day}:${now.getTime()}:${Math.random().toString(36).slice(2, 6)}:${clean(who)}:${clean(action)}:${clean(detail)}:${clean(geo.country)}:${place}`;
    const value = { geo, ua, lang: req && req.headers && req.headers.get ? String(req.headers.get("accept-language") || "").slice(0, 40) : "", ref: req && req.headers && req.headers.get ? String(req.headers.get("referer") || "").slice(0, 200) : "", visitor: req ? visitorId(req) : null };
    await store.set(key, value);
  } catch (e) {
    console.warn("logEvent failed", e.message);
  }
}

function parseKey(k) {
  const [, day, ms, , user, action, detail, country = "ZZ", place = ""] = k.split(":");
  const [region = "", city = ""] = place.split("~");
  const tidy = (x) => x.replace(/_/g, " ").trim() || null;
  const bot = !!user && user.startsWith("b_");
  // "anon" = no client IP at all: a server-side call (AI jobs, background work) or local development, never a browser.
  const system = !user || user === "anon" || user === "system";
  return { key: k, day: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`, ts: Number(ms), user, action, detail, country: country || "ZZ", region: tidy(region), city: tidy(city), anon: system || user.startsWith("v_") || bot, bot, test: isTestUser(user), system };
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

/**
 * Re-keys past events whose stored user agent is a crawler or script from v_<hash> to b_<name>,
 * so the usage figures exclude them, and drops the daily rollups of the days it touched.
 * Reads one value per anonymous event, so it runs in a background function.
 */
export async function reclassifyEvents(days = 30) {
  const store = await openStore("events");
  const jobs = await openStore("jobs");
  const events = (await listEvents(days)).filter((e) => e.user && e.user.startsWith("v_"));
  const touchedDays = new Set();
  let moved = 0, read = 0;
  for (const e of events) {
    const v = await store.get(e.key).catch(() => null); read++;
    if (!v || typeof v !== "object" || !isBotUa(v.ua)) continue;
    const parts = e.key.split(":"); parts[4] = `b_${botName(v.ua)}`;
    await store.set(parts.join(":"), { ...v, reclassifiedFrom: e.user });
    await store.delete(e.key);
    moved++; touchedDays.add(e.day.replace(/-/g, ""));
  }
  for (const d of touchedDays) await jobs.delete(`rollup2:${d}`).catch(() => {});
  return { read, moved, days: touchedDays.size };
}
