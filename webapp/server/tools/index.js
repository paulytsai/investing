// POST /api/tools: the server side of the page's mcp.callTool(server, tool, input). Returns {payload}, exactly what
// the claude.ai connector returned, so the page's call() works unchanged.
import { Hono } from "hono";
import { fail, rateLimit } from "../http.js";
import { requireUser, licencedForOthers } from "../auth.js";
import { registerCompany, checkDailyCalls, recordEvent } from "../meter.js";
import { callFmp, resolveFmp } from "./fmp.js";
import { callEdgar, EDGAR_TOOLS } from "./edgar.js";

export function toolsRoutes(db) {
  const r = new Hono();
  r.use("*", requireUser);

  r.post("/", async (c) => {
    const user = c.get("user");
    const { server, tool, input } = (await c.req.json().catch(() => ({}))) || {};
    if (typeof server !== "string" || typeof tool !== "string" || !input || typeof input !== "object") fail(400, "bad_request", "Expected {server, tool, input}.");
    if (user.role !== "owner" && db.get("SELECT enabled FROM feature_flags WHERE key = 'maintenance'")?.enabled) fail(503, "maintenance", "The app is in maintenance. Try again later.");
    rateLimit("tools:" + user.id, 60, 10, "data requests");
    const t0 = Date.now();
    c.header("cache-control", "private, no-store");

    if (server === "FMP") {
      // personal licence: FMP data goes only to the owner until a display licence is recorded
      if (user.role !== "owner" && !licencedForOthers(db)) fail(403, "not_licensed", "Market data isn't available to other accounts yet.");
      const { ticker } = resolveFmp(tool, input);
      checkDailyCalls(db, user, "fmp");
      if (ticker) registerCompany(db, user, ticker);
      try {
        const out = await callFmp(db, tool, input);
        recordEvent(db, { userId: user.id, feature: "fmp", provider: "fmp", ticker, endpoint: tool + "/" + input.endpoint, cacheHit: out.cacheHit, ms: Date.now() - t0, status: out.stale ? "stale" : "ok" });
        return c.json({ payload: out.payload });
      } catch (e) {
        recordEvent(db, { userId: user.id, feature: "fmp", provider: "fmp", ticker, endpoint: tool + "/" + input.endpoint, ms: Date.now() - t0, status: "error" });
        throw e;
      }
    }

    if (server === "Edgar Tools") {
      if (!EDGAR_TOOLS.includes(tool)) fail(400, "unknown_tool", `Edgar Tools ${tool} isn't available here.`);
      const ticker = typeof input.company === "string" ? input.company.toUpperCase() : null;
      checkDailyCalls(db, user, "sec");
      const out = await callEdgar(db, tool, input, { user });
      recordEvent(db, { userId: user.id, feature: "sec", provider: out.provider, ticker, endpoint: tool, cacheHit: out.cacheHit, ms: Date.now() - t0 });
      return c.json({ payload: out.payload });
    }

    fail(400, "unknown_server", `No connector named ${server}.`);
  });
  return r;
}
