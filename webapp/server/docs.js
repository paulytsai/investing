// The user's own documents: the server side of the artifact's db.collection("data/users/<uid>") store.
// Ids are the page's own: model-<TICKER> (inputs, notes, drafts), sec-<TICKER> (segment cache), calls-... (call
// summaries). Each user sees only their own rows; admins see counts, never contents.
import { Hono } from "hono";
import { nowIso } from "./db.js";
import { fail, rateLimit } from "./http.js";
import { requireUser } from "./auth.js";
import { limitsFor } from "./meter.js";

const ID = /^[A-Za-z0-9_~:@+.-]{1,200}$/;
const MAX_BYTES = 1_000_000;
const HISTORY = 20;
const kindOf = (id) => (/^(model|sec|calls)-/.exec(id)?.[1]) || "other";

export function docsRoutes(db) {
  const r = new Hono();
  r.use("*", requireUser);

  r.get("/", (c) => {
    const rows = db.all("SELECT doc_id, json, ticker, updated_at_ms FROM user_docs WHERE user_id = ? ORDER BY doc_id", c.get("user").id);
    return c.json({ docs: rows.map((x) => ({ id: x.doc_id, data: { json: x.json, ticker: x.ticker, updatedAt: x.updated_at_ms } })) });
  });

  r.get("/:id", (c) => {
    const id = c.req.param("id");
    if (!ID.test(id)) fail(400, "bad_id", "Bad document id.");
    const x = db.get("SELECT json, ticker, updated_at_ms FROM user_docs WHERE user_id = ? AND doc_id = ?", c.get("user").id, id);
    return c.json(x ? { exists: true, data: { json: x.json, ticker: x.ticker, updatedAt: x.updated_at_ms } } : { exists: false });
  });

  r.put("/:id", async (c) => {
    const user = c.get("user"), id = c.req.param("id");
    if (!ID.test(id)) fail(400, "bad_id", "Bad document id.");
    rateLimit("docs:" + user.id, 60, 2, "saves");
    const body = await c.req.json().catch(() => null);
    const data = body?.data;
    if (!data || typeof data.json !== "string") fail(400, "bad_request", "Expected {data: {json, ticker, updatedAt}}.");
    try { JSON.parse(data.json); } catch (e) { fail(400, "bad_request", "json must be a JSON string."); }
    const bytes = Buffer.byteLength(data.json);
    if (bytes > MAX_BYTES) fail(413, "too_large", "This document is too large to save.");
    const kind = kindOf(id), now = nowIso();
    db.tx(() => {
      const prev = db.get("SELECT json FROM user_docs WHERE user_id = ? AND doc_id = ?", user.id, id);
      if (!prev && kind === "model") {
        const lim = limitsFor(db, user).limits.saved_models;
        const n = db.get("SELECT COUNT(*) AS n FROM user_docs WHERE user_id = ? AND kind = 'model'", user.id).n;
        if (lim !== null && lim !== undefined && n >= lim) fail(402, "quota_exceeded", `Your plan saves up to ${lim} models.`, { limit: "saved_models" });
      }
      if (prev && prev.json !== data.json && kind === "model") {
        db.run("INSERT INTO user_docs_history (user_id, doc_id, json, saved_at) VALUES (?, ?, ?, ?)", user.id, id, prev.json, now);
        db.run(`DELETE FROM user_docs_history WHERE user_id = ? AND doc_id = ? AND id NOT IN
                (SELECT id FROM user_docs_history WHERE user_id = ? AND doc_id = ? ORDER BY id DESC LIMIT ${HISTORY})`, user.id, id, user.id, id);
      }
      db.run(`INSERT INTO user_docs (user_id, doc_id, kind, ticker, json, bytes, updated_at_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (user_id, doc_id) DO UPDATE SET json = excluded.json, ticker = excluded.ticker, bytes = excluded.bytes,
              updated_at_ms = excluded.updated_at_ms, updated_at = excluded.updated_at`,
        user.id, id, kind, typeof data.ticker === "string" ? data.ticker.slice(0, 16) : null, data.json, bytes, Number(data.updatedAt) || Date.now(), now, now);
    });
    return c.json({ ok: true });
  });

  // version history of a saved model (the last 20 saves), for recovery
  r.get("/:id/history", (c) => {
    const id = c.req.param("id");
    if (!ID.test(id)) fail(400, "bad_id", "Bad document id.");
    return c.json({ versions: db.all("SELECT id, saved_at, length(json) AS bytes FROM user_docs_history WHERE user_id = ? AND doc_id = ? ORDER BY id DESC", c.get("user").id, id) });
  });
  r.get("/:id/history/:vid", (c) => {
    const x = db.get("SELECT json, saved_at FROM user_docs_history WHERE user_id = ? AND doc_id = ? AND id = ?", c.get("user").id, c.req.param("id"), Number(c.req.param("vid")));
    if (!x) fail(404, "not_found", "No such version.");
    return c.json(x);
  });
  return r;
}
