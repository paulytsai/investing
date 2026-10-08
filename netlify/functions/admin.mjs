// Admin panel API: usage stats, users, warmer control. Requires role "admin".
import { json, handler, param, HttpError } from "../lib/http.mjs";
import { requireAdmin, entitlement } from "../lib/entitlement.mjs";
import { listUsers } from "../lib/users.mjs";
import { listEvents } from "../lib/events.mjs";
import { openStore } from "../lib/store.mjs";
import { cfg } from "../lib/config.mjs";
import { warmUniverse } from "../lib/universe.mjs";
import { dispatchWarm, warmStatus, warmCoverage, warmSettings } from "../lib/warmer.mjs";

const PRICE_IN = 4 / 1e6, PRICE_OUT = 20 / 1e6; // claude-opus-5-5 list prices per token

export default handler(async (req, context) => {
  await requireAdmin(req);
  const action = param(context, "action");

  if (action === "stats") {
    const days = 30;
    const [allEvents, allUsers, jobs] = await Promise.all([listEvents(days), listUsers(), openStore("jobs")]);
    // Developer/admin accounts are excluded from every usage figure.
    const adminNames = new Set(allUsers.filter((u) => u.role === "admin").map((u) => u.username));
    const users = allUsers.filter((u) => u.role !== "admin");
    const events = allEvents.filter((e) => !adminNames.has(e.user));
    const now = Date.now();
    const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
    const byDay = {};
    for (let i = days - 1; i >= 0; i--) byDay[dayKey(now - i * 86400000)] = { views: 0, demo: 0, logins: 0, signups: 0, searches: 0, ai: 0, users: new Set() };
    const bySymbol = {}, lastSeen = {};
    let cost = 0, generations = 0, translations = 0;
    for (const e of events) {
      const d = byDay[e.day]; if (!d) continue;
      if (e.action === "view") { d.views++; bySymbol[e.detail] = (bySymbol[e.detail] || 0) + 1; }
      else if (e.action === "demo_view") d.demo++;
      else if (e.action === "login") d.logins++;
      else if (e.action === "signup") d.signups++;
      else if (e.action === "search") d.searches++;
      else if (e.action === "ai_generate") { d.ai++; generations++; const [, inp, out] = e.detail.split("_"); cost += Number(inp || 0) * PRICE_IN + Number(out || 0) * PRICE_OUT; }
      else if (e.action === "ai_translate") { translations++; cost += 0.03; }
      if (e.user && e.user !== "anon" && e.user !== "system") { d.users.add(e.user); if (!lastSeen[e.user]) lastSeen[e.user] = e.ts; }
    }
    const series = Object.entries(byDay).map(([day, d]) => ({ day, views: d.views, demo: d.demo, logins: d.logins, signups: d.signups, searches: d.searches, ai: d.ai, activeUsers: d.users.size }));
    const activeIn = (ms) => new Set(events.filter((e) => now - e.ts < ms && e.user && e.user !== "anon" && e.user !== "system").map((e) => e.user)).size;
    const states = {};
    for (const u of users) { const st = entitlement(u).state; states[st] = (states[st] || 0) + 1; }
    const warm = (await warmStatus()).last;
    const coverage = await warmCoverage();
    const universe = warmUniverse();
    const langs = [...new Set(["en", ...cfg.locales()])];
    const covCounts = Object.fromEntries(langs.map((l) => [l, universe.filter((sym) => coverage[sym]?.ready?.[l]).length]));
    const pending = universe.filter((sym) => !langs.every((l) => coverage[sym]?.ready?.[l]));
    return json({
      generatedAt: new Date().toISOString(),
      totals: { users: users.length, states, signups7d: users.filter((u) => now - u.createdAt < 7 * 86400000).length, signups30d: users.filter((u) => now - u.createdAt < 30 * 86400000).length, activeToday: activeIn(86400000), active7d: activeIn(7 * 86400000), active30d: activeIn(30 * 86400000), views30d: series.reduce((a, d) => a + d.views, 0), demo30d: series.reduce((a, d) => a + d.demo, 0), aiGenerations30d: generations, aiTranslations30d: translations, aiCostUsd30d: Math.round(cost * 100) / 100 },
      series,
      topSymbols: Object.entries(bySymbol).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([symbol, views]) => ({ symbol, views })),
      recent: events.slice(0, 60),
      warm: { universe: universe.length, perRun: warmSettings().perRun, settings: warmSettings(), last: warm, langs, coverage: covCounts, pending, current: warm?.running ? [].concat(warm.current || []).join(", ") : null },
      users: allUsers.slice(0, 200).map((u) => ({ username: u.username, email: u.email, createdAt: u.createdAt, state: entitlement(u).state, status: u.subscription?.status || null, role: u.role || null, lastSeen: lastSeen[u.username] || null })),
    });
  }

  if (action === "warm" && req.method === "POST") {
    return json(await dispatchWarm({ full: query(req).get("full") === "1" }));
  }

  throw new HttpError(404, "not_found");
});

export const config = { path: "/api/admin/:action" };
