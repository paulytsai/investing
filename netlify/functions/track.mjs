// POST /api/track {action, detail}: client-side usage events (tab opened, chart range, page view)
// recorded in the same log as server-side views, with the member or anonymous visitor and location.
import { json, handler, HttpError } from "../lib/http.mjs";
import { currentUser } from "../lib/entitlement.mjs";
import { logEvent } from "../lib/events.mjs";

const ACTIONS = new Set(["page", "tab", "range", "techrange", "target", "deep_open", "cta", "sector_report", "lang"]);

export default handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
  let body = {}; try { body = await req.json(); } catch {}
  const action = String(body.action || "");
  if (!ACTIONS.has(action)) throw new HttpError(400, "bad_action");
  const user = await currentUser(req).catch(() => null);
  await logEvent(action, { user, detail: String(body.detail || "").slice(0, 40), req });
  return json({ ok: true });
});

export const config = { path: "/api/track" };
