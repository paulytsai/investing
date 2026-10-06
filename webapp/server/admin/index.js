// Admin API (placeholder; the full admin area replaces this).
import { Hono } from "hono";
import { requireAdmin } from "../auth.js";
export function adminRoutes(db) {
  const r = new Hono();
  r.use("*", requireAdmin);
  r.get("/overview", (c) => c.json({ users: db.get("SELECT COUNT(*) AS n FROM profiles").n }));
  return r;
}
