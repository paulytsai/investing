// Contact form: stores every message and emails it to CONTACT_TO (or the MAIL_FROM address).
import crypto from "node:crypto";
import { json, handler, readJson, HttpError } from "../lib/http.mjs";
import { openStore } from "../lib/store.mjs";
import { sendMail, mailConfigured } from "../lib/mail.mjs";
import { currentUser } from "../lib/entitlement.mjs";
import { logEvent } from "../lib/events.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export default handler(async (req, context) => {
  if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
  const body = await readJson(req);
  if (body.website) return json({ ok: true }); // honeypot: bots fill the hidden field
  const name = String(body.name || "").trim().slice(0, 100);
  const email = String(body.email || "").trim().slice(0, 254);
  const message = String(body.message || "").trim().slice(0, 4000);
  if (!name) throw new HttpError(400, "invalid_name");
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "invalid_email");
  if (message.length < 10) throw new HttpError(400, "message_too_short");

  // Light rate limit: at most 5 messages per address per hour.
  const store = await openStore("contact");
  const ip = (context?.ip) || req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "unknown";
  const rlKey = `rl:${email.toLowerCase()}`;
  const rl = (await store.get(rlKey)) || { count: 0, since: Date.now() };
  if (Date.now() - rl.since > 3600000) { rl.count = 0; rl.since = Date.now(); }
  if (rl.count >= 5) throw new HttpError(429, "too_many_messages");
  rl.count++; await store.set(rlKey, rl);

  const user = await currentUser(req).catch(() => null);
  const rec = { id: crypto.randomUUID(), name, email, message, username: user ? user.username : null, ip: String(ip).slice(0, 64), ua: String(req.headers.get("user-agent") || "").slice(0, 200), createdAt: new Date().toISOString(), sent: false };
  const to = process.env.CONTACT_TO || (process.env.MAIL_FROM || "").replace(/^.*<([^>]+)>.*$/, "$1");
  if (mailConfigured() && to) {
    try {
      await sendMail({ to, replyTo: email, subject: `[Kabukaizu contact] ${name}`, text: `From: ${name} <${email}>${user ? ` (user ${user.username})` : ""}\n\n${message}`, html: `<p><b>${esc(name)}</b> &lt;${esc(email)}&gt;${user ? ` (user ${esc(user.username)})` : ""}</p><pre style="font-family:sans-serif;white-space:pre-wrap">${esc(message)}</pre>` });
      rec.sent = true;
    } catch (e) { console.error("contact mail failed", e.message); }
  }
  await store.set(`msg:${rec.createdAt}:${rec.id}`, rec);
  await logEvent("contact", { user, detail: email, req });
  return json({ ok: true, sent: rec.sent });
});

export const config = { path: "/api/contact" };
