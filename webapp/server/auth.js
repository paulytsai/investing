// Sign-in with one-time email codes, cookie sessions, roles, and TOTP for the admin area.
// Personal phase: until a display licence for FMP data is recorded in the admin settings, only the owner can sign in.
import crypto from "node:crypto";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { config } from "./config.js";
import { nowIso } from "./db.js";
import { fail, rateLimit, clientIp } from "./http.js";
import { sendMail } from "./mailer.js";

const COOKIE = "cm_sid";
const CODE_TTL_MS = 10 * 60 * 1000;
const LIVE_CODES = 3;                    // codes stay valid when another is requested, so nobody can cancel yours
const STEP_UP_MS = 12 * 3600e3;          // an authenticator check opens the admin area for 12 hours
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const emailOk = (e) => typeof e === "string" && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ---------- TOTP (RFC 6238, SHA-1, 30 s steps, 6 digits) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s) {
  let bits = 0, value = 0; const out = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function totpCode(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, "0");
}
const currentStep = () => Math.floor(Date.now() / 30000);
// accepts the previous, current and next step; refuses a step already used (replay)
function checkTotp(profile, code) {
  if (!profile.totp_secret || !/^\d{6}$/.test(String(code || ""))) return null;
  const now = currentStep();
  for (const s of [now - 1, now, now + 1]) {
    if (s > profile.totp_last_step && crypto.timingSafeEqual(Buffer.from(totpCode(profile.totp_secret, s)), Buffer.from(String(code)))) return s;
  }
  return null;
}

// ---------- policy ----------
export function licencedForOthers(db) { return !!db.getConfig("licences")?.fmp_display?.signed_at; }

// who may receive a code: the owner always; others when allowlisted (or sign-ups are open), and only once a
// display licence is recorded, because every page of the app shows FMP data
function signInRole(db, email) {
  if (config.ownerEmail && email === config.ownerEmail) return "owner";
  const prof = db.get("SELECT role, status FROM profiles WHERE email = ?", email);
  if (prof && prof.status !== "active") return null;
  if (!licencedForOthers(db)) return prof?.role === "owner" ? "owner" : null;
  const al = db.get("SELECT role FROM allowlist WHERE email = ?", email);
  if (al) return al.role;
  if (prof) return prof.role;
  return db.getConfig("signups")?.open ? "user" : null;
}

function ensureProfile(db, email, role) {
  let p = db.get("SELECT * FROM profiles WHERE email = ?", email);
  if (!p) {
    const id = crypto.randomUUID();
    db.run("INSERT INTO profiles (id, email, role, created_at) VALUES (?, ?, ?, ?)", id, email, role, nowIso());
    db.run("UPDATE allowlist SET accepted_at = ? WHERE email = ? AND accepted_at IS NULL", nowIso(), email);
    db.audit(id, "profile.created", email, null, { role });
    p = db.get("SELECT * FROM profiles WHERE id = ?", id);
  } else if (role === "owner" && p.role !== "owner") {
    db.run("UPDATE profiles SET role = 'owner' WHERE id = ?", p.id);
    p = db.get("SELECT * FROM profiles WHERE id = ?", p.id);
  }
  return p;
}

function newSession(c, db, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = Date.now() + config.sessionDays * 864e5;
  db.run("INSERT INTO sessions (id, user_id, created_at, expires_at_ms, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
    sha256(token), userId, nowIso(), expires, nowIso(), clientIp(c), (c.req.header("user-agent") || "").slice(0, 200));
  db.run("UPDATE profiles SET last_seen_at = ? WHERE id = ?", nowIso(), userId);
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Lax", secure: config.cookieSecure, path: "/", maxAge: config.sessionDays * 86400 });
}

// ---------- middleware ----------
export function sessionMiddleware(db) {
  return async (c, next) => {
    const token = getCookie(c, COOKIE);
    if (token) {
      const s = db.get("SELECT * FROM sessions WHERE id = ?", sha256(token));
      if (s && s.expires_at_ms > Date.now()) {
        const p = db.get("SELECT * FROM profiles WHERE id = ?", s.user_id);
        if (p && p.status === "active") {
          c.set("user", p); c.set("session", s);
          // touch at most once a minute
          if (!s.last_seen_at || Date.now() - Date.parse(s.last_seen_at) > 60000) {
            db.run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", nowIso(), s.id);
            db.run("UPDATE profiles SET last_seen_at = ? WHERE id = ?", nowIso(), p.id);
          }
        }
      }
    }
    return next();
  };
}
export const requireUser = async (c, next) => { if (!c.get("user")) fail(401, "not_signed_in", "Sign in to continue."); return next(); };
// admins need TOTP in this session (step-up); the owner too
export const requireAdmin = async (c, next) => {
  const u = c.get("user");
  if (!u) fail(401, "not_signed_in", "Sign in to continue.");
  if (u.role !== "owner" && u.role !== "admin") fail(403, "forbidden", "Admins only.");
  const s = c.get("session");
  const stepped = s.aal >= 2 && s.aal_at && Date.now() - s.aal_at < STEP_UP_MS;
  if (config.requireAdminMfa && (!u.totp_enrolled || !stepped)) fail(403, "mfa_required", u.totp_enrolled ? "Enter your authenticator code to open the admin area." : "Set up an authenticator app to open the admin area.");
  return next();
};
export const requireOwner = async (c, next) => {
  await requireAdmin(c, async () => {});
  if (c.get("user").role !== "owner") fail(403, "forbidden", "Only the owner can change this.");
  return next();
};

// ---------- routes ----------
export function authRoutes(db) {
  const r = new Hono();

  r.post("/start", async (c) => {
    const { email: raw, locale } = await c.req.json().catch(() => ({}));
    const email = String(raw || "").trim().toLowerCase();
    if (!emailOk(email)) fail(400, "bad_email", "Enter a valid email address.");
    rateLimit("start:ip:" + clientIp(c), 5, 5 / 60, "sign-in attempts");
    rateLimit("start:email:" + email, 5, 5 / 600, "codes for this email");
    const role = signInRole(db, email);
    if (role) {
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
      db.run("INSERT INTO login_codes (email, code_hash, expires_at_ms, created_at) VALUES (?, ?, ?, ?)", email, sha256(email + ":" + code), Date.now() + CODE_TTL_MS, nowIso());
      const ja = locale === "ja", zh = locale === "zh";
      const subject = ja ? "サインインコード: " + code : zh ? "登入驗證碼：" + code : "Your sign-in code: " + code;
      const body = ja ? `コードは ${code} です。10分間有効です。` : zh ? `您的驗證碼是 ${code}，10 分鐘內有效。` : `Your code is ${code}. It expires in 10 minutes. If you didn't ask for it, ignore this email.`;
      await sendMail(db, email, subject, body);
    }
    // the same answer either way, so the form doesn't reveal who has access
    return c.json({ ok: true });
  });

  r.post("/verify", async (c) => {
    const { email: raw, code } = await c.req.json().catch(() => ({}));
    const email = String(raw || "").trim().toLowerCase();
    rateLimit("verify:ip:" + clientIp(c), 10, 10 / 60, "attempts");
    rateLimit("verify:email:" + email, 10, 10 / 600, "attempts for this email");
    // the newest few unexpired codes; one answer for "no code", "expired" and "wrong", so it doesn't reveal who has access
    const live = db.all("SELECT * FROM login_codes WHERE email = ? AND used_at IS NULL AND expires_at_ms > ? AND attempts < 5 ORDER BY id DESC LIMIT ?", email, Date.now(), LIVE_CODES);
    const given = /^\d{6}$/.test(String(code || "")) ? Buffer.from(sha256(email + ":" + code)) : null;
    const row = given && live.find((x) => crypto.timingSafeEqual(Buffer.from(x.code_hash), given));
    const role = row ? signInRole(db, email) : null;
    if (!row || !role) {
      for (const x of live) db.run("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?", x.id);
      fail(400, "code_invalid", "That code isn't right, or it has expired. Ask for a new one.");
    }
    db.run("UPDATE login_codes SET used_at = ? WHERE email = ? AND used_at IS NULL", nowIso(), email);
    const p = ensureProfile(db, email, role);
    newSession(c, db, p.id);
    db.audit(p.id, "auth.signed_in", email);
    return c.json({ ok: true });
  });

  r.post("/logout", async (c) => {
    const token = getCookie(c, COOKIE);
    if (token) db.run("DELETE FROM sessions WHERE id = ?", sha256(token));
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // TOTP enrolment: setup returns a secret and an otpauth URI for the authenticator app; enable checks a first code
  r.post("/totp/setup", requireUser, async (c) => {
    const u = c.get("user");
    if (u.totp_enrolled) fail(400, "already_enrolled", "An authenticator is already set up.");
    const secret = base32Encode(crypto.randomBytes(20));
    db.run("UPDATE profiles SET totp_secret = ?, totp_last_step = 0 WHERE id = ?", secret, u.id);
    const label = encodeURIComponent("Company model:" + u.email);
    return c.json({ secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("Company model")}&algorithm=SHA1&digits=6&period=30` });
  });
  r.post("/totp/enable", requireUser, async (c) => {
    const { code } = await c.req.json().catch(() => ({}));
    const u = db.get("SELECT * FROM profiles WHERE id = ?", c.get("user").id);
    rateLimit("totp:" + u.id, 5, 5 / 60, "attempts");
    const step = checkTotp(u, code);
    if (!step) fail(400, "code_wrong", "That code isn't right. Check the time on your phone.");
    db.run("UPDATE profiles SET totp_enrolled = 1, totp_last_step = ? WHERE id = ?", step, u.id);
    db.run("UPDATE sessions SET aal = 2, aal_at = ? WHERE id = ?", Date.now(), c.get("session").id);
    db.audit(u.id, "auth.totp_enrolled", u.email);
    return c.json({ ok: true });
  });
  r.post("/totp/verify", requireUser, async (c) => {
    const { code } = await c.req.json().catch(() => ({}));
    const u = db.get("SELECT * FROM profiles WHERE id = ?", c.get("user").id);
    rateLimit("totp:" + u.id, 5, 5 / 60, "attempts");
    if (!u.totp_enrolled) fail(400, "not_enrolled", "Set up an authenticator first.");
    const step = checkTotp(u, code);
    if (!step) fail(400, "code_wrong", "That code isn't right.");
    db.run("UPDATE profiles SET totp_last_step = ? WHERE id = ?", step, u.id);
    db.run("UPDATE sessions SET aal = 2, aal_at = ? WHERE id = ?", Date.now(), c.get("session").id);
    return c.json({ ok: true });
  });
  return r;
}

// bootstrap: the owner's allowlist row
export function ensureOwner(db) {
  if (!config.ownerEmail) return;
  db.run("INSERT INTO allowlist (email, role, invited_at, note) VALUES (?, 'owner', ?, 'OWNER_EMAIL') ON CONFLICT (email) DO UPDATE SET role = 'owner'", config.ownerEmail, nowIso());
}
