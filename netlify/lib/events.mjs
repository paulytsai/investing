// Usage events for the admin panel. Each event is a blob whose KEY carries the
// data (ev:<yyyymmdd>:<ms>:<rand>:<user>:<action>:<detail>), so listing keys by
// day prefix gives the full log without reading any values.
import { openStore } from "./store.mjs";

const clean = (s) => String(s ?? "").replace(/[^A-Za-z0-9_.\-]/g, "_").slice(0, 40);

/** True when the request comes from a browser that has logged in as admin (developer traffic). */
export function isDevRequest(req) {
  const cookie = req && req.headers && req.headers.get ? req.headers.get("cookie") || "" : "";
  return /(^|;\s*)kz_dev=1(;|$)/.test(cookie);
}

export const DEV_COOKIE = "kz_dev=1; Path=/; Max-Age=31536000; SameSite=Lax";

export async function logEvent(action, { user, detail, req } = {}) {
  try {
    if ((user && user.role === "admin") || isDevRequest(req)) return; // developer traffic is never recorded
    const store = await openStore("events");
    const now = new Date();
    const day = now.toISOString().slice(0, 10).replace(/-/g, "");
    const key = `ev:${day}:${now.getTime()}:${Math.random().toString(36).slice(2, 6)}:${clean(user ? user.username : "anon")}:${clean(action)}:${clean(detail)}`;
    await store.set(key, 1);
  } catch (e) {
    console.warn("logEvent failed", e.message);
  }
}

/** Events for the last `days` days (newest first). */
export async function listEvents(days = 14) {
  const store = await openStore("events");
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
    const keys = await store.list(`ev:${d}:`);
    for (const k of keys) {
      const [, day, ms, , user, action, detail] = k.split(":");
      out.push({ day: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`, ts: Number(ms), user, action, detail });
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}
