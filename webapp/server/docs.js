// The user's own documents: the server side of the artifact's db.collection("data/users/<uid>") store.
// Ids are the page's own: model-<TICKER> (inputs, notes, drafts), sec-<TICKER> (segment cache), calls-... (call
// summaries). Each user sees only their own rows; admins see counts, never contents.
import { Hono } from "hono";
import { nowIso } from "./db.js";
import { fail, rateLimit } from "./http.js";
import { requireUser } from "./auth.js";
import { limitsFor, DEMO_TICKER } from "./meter.js";

// the page's ids only: model-<T>, sec-<T>, calls-<T> (T sanitised the way the page does it)
const ID = /^(model|sec|calls)-[A-Za-z0-9_~:@+-]{1,40}$/;
// per user, whatever the kind: a plan's saved models bring their segment and call documents with them
const docCap = (lim) => (lim === null || lim === undefined ? 5000 : lim * 3 + 10);
const bytesCap = (lim) => (lim === null || lim === undefined ? 500e6 : 50e6);
const MAX_BYTES = 1_000_000;
const HISTORY = 20;
const kindOf = (id) => /^(model|sec|calls)-/.exec(id)[1];

export function docsRoutes(db) {
  const r = new Hono();
  r.use("*", requireUser);

  r.get("/", (c) => {
    // ?meta=1: the list without contents, for the account menu
    if (c.req.query("meta")) {
      const docs = db.all("SELECT doc_id AS id, kind, ticker, bytes, updated_at_ms AS updatedAt FROM user_docs WHERE user_id = ? ORDER BY doc_id", c.get("user").id);
      return c.json({ docs });
    }
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
      const prev = db.get("SELECT json, bytes FROM user_docs WHERE user_id = ? AND doc_id = ?", user.id, id);
      const lim = limitsFor(db, user).limits.saved_models;
      const tot = db.get("SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM user_docs WHERE user_id = ?", user.id);
      if (!prev && tot.n >= docCap(lim)) fail(402, "quota_exceeded", "You've reached the storage limit for your plan.", { limit: "storage" });
      if (tot.b - (prev?.bytes || 0) + bytes > bytesCap(lim)) fail(402, "quota_exceeded", "You've reached the storage limit for your plan.", { limit: "storage" });
      if (!prev && kind === "model" && id !== "model-" + DEMO_TICKER) {
        // the opening company (MSFT) is saved for everyone on their first visit, so it doesn't take a slot
        const n = db.get("SELECT COUNT(*) AS n FROM user_docs WHERE user_id = ? AND kind = 'model' AND doc_id != ?", user.id, "model-" + DEMO_TICKER).n;
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

  // delete a saved company: its model, segment and call-summary documents and the model's history
  r.delete("/:id", (c) => {
    const user = c.get("user"), id = c.req.param("id");
    const m = /^model-(.+)$/.exec(id);
    if (!m || !ID.test(id)) fail(400, "bad_id", "Only saved models can be deleted.");
    const ids = ["model-", "sec-", "calls-"].map((p) => p + m[1]);
    const n = db.tx(() => {
      db.run(`DELETE FROM user_docs_history WHERE user_id = ? AND doc_id IN (?, ?, ?)`, user.id, ...ids);
      return Number(db.run(`DELETE FROM user_docs WHERE user_id = ? AND doc_id IN (?, ?, ?)`, user.id, ...ids).changes);
    });
    return c.json({ ok: true, deleted: n });
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
