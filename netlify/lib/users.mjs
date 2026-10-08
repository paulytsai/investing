// User accounts: username + email + password, with a free trial that starts at signup.
import crypto from "node:crypto";
import { openStore } from "./store.mjs";
import { cfg } from "./config.mjs";
import { HttpError } from "./http.mjs";

const USERNAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{2,31}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  const [algo, saltB64, hashB64] = (stored || "").split("$");
  if (algo !== "scrypt") return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function validateSignup({ username, email, password }) {
  if (!USERNAME_RE.test(username || "")) throw new HttpError(400, "invalid_username");
  if (!EMAIL_RE.test(email || "") || email.length > 254) throw new HttpError(400, "invalid_email");
  if (typeof password !== "string" || password.length < 8 || password.length > 200) throw new HttpError(400, "weak_password");
}

export async function createUser({ username, email, password, locale }) {
  validateSignup({ username, email, password });
  const users = await openStore("users");
  const emailKey = `email:${normalizeEmail(email)}`;
  const nameKey = `username:${username.toLowerCase()}`;
  const id = crypto.randomUUID();

  // Reserve the unique indexes first so two concurrent signups cannot collide.
  const e = await users.set(emailKey, { id }, { onlyIfNew: true });
  if (!e.modified) throw new HttpError(409, "email_taken");
  const n = await users.set(nameKey, { id }, { onlyIfNew: true });
  if (!n.modified) {
    await users.delete(emailKey);
    throw new HttpError(409, "username_taken");
  }

  const now = Date.now();
  const user = {
    id,
    username,
    email: normalizeEmail(email),
    passwordHash: hashPassword(password),
    locale: locale || cfg.defaultLocale(),
    createdAt: now,
    trialEndsAt: now + cfg.trialDays() * 86400 * 1000,
    subscription: null,
  };
  await users.set(`user:${id}`, user);
  return user;
}

export async function getUser(id) {
  if (!id) return null;
  const users = await openStore("users");
  return users.get(`user:${id}`);
}

export async function findUserByLogin(login) {
  const users = await openStore("users");
  const l = String(login || "").trim();
  const key = l.includes("@") ? `email:${normalizeEmail(l)}` : `username:${l.toLowerCase()}`;
  const idx = await users.get(key);
  if (!idx?.id) return null;
  return users.get(`user:${idx.id}`);
}

export async function findUserByEmail(email) {
  const users = await openStore("users");
  const idx = await users.get(`email:${normalizeEmail(email)}`);
  return idx?.id ? users.get(`user:${idx.id}`) : null;
}

export async function saveUser(user) {
  const users = await openStore("users");
  await users.set(`user:${user.id}`, user);
  return user;
}

/** Strip secrets before returning a user to the browser. */
export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

/** Log a built-in account in: creates it on first use, keeps role/plan in sync. */
export async function loginBuiltin(login, password) {
  const acct = cfg.builtinAccounts().find((a) => a.username.toLowerCase() === String(login || "").trim().toLowerCase());
  if (!acct || password !== acct.password) return null;
  const users = await openStore("users");
  const idx = await users.get(`username:${acct.username.toLowerCase()}`);
  let user = idx?.id ? await users.get(`user:${idx.id}`) : null;
  if (user && !user.builtin) return null; // a registered user holds this name; refuse to upgrade it
  if (!user) {
    const id = crypto.randomUUID();
    const email = `${acct.username.toLowerCase()}@${(cfg.brand().id || "site")}.local`;
    await users.set(`username:${acct.username.toLowerCase()}`, { id });
    await users.set(`email:${email}`, { id });
    user = { id, username: acct.username, email, passwordHash: hashPassword(password), locale: cfg.defaultLocale(), createdAt: Date.now(), trialEndsAt: 0, subscription: null, builtin: true };
  }
  user.role = acct.role; user.plan = "free"; user.builtin = true;
  if (!verifyPassword(password, user.passwordHash)) user.passwordHash = hashPassword(password);
  await users.set(`user:${user.id}`, user);
  return user;
}

export async function deleteUser(user) {
  const users = await openStore("users");
  await users.delete(`user:${user.id}`);
  await users.delete(`email:${normalizeEmail(user.email)}`);
  await users.delete(`username:${String(user.username).toLowerCase()}`);
}

export async function listUsers() {
  const users = await openStore("users");
  const keys = await users.list("user:");
  const out = [];
  for (const k of keys) { const u = await users.get(k); if (u) out.push(publicUser(u)); }
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ---- password reset tokens (one-time, 1 hour) ----
const RESET_TTL_MS = 60 * 60 * 1000;
const tokenHash = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

export async function createResetToken(user) {
  const users = await openStore("users");
  const token = crypto.randomBytes(32).toString("hex");
  const rec = { userId: user.id, email: user.email, username: user.username, createdAt: Date.now(), expiresAt: Date.now() + RESET_TTL_MS };
  await users.set(`reset:${tokenHash(token)}`, rec);
  await users.set(`resetlog:${user.id}`, { ...rec, token }); // lets an admin hand the link over when email is not configured
  return token;
}

export async function consumeResetToken(token) {
  const users = await openStore("users");
  const key = `reset:${tokenHash(token)}`;
  const rec = await users.get(key);
  if (!rec || rec.expiresAt < Date.now()) return null;
  await users.delete(key);
  await users.delete(`resetlog:${rec.userId}`).catch(() => {});
  return getUser(rec.userId);
}

export async function pendingResets() {
  const users = await openStore("users");
  const out = [];
  for (const key of await users.list("resetlog:")) { const r = await users.get(key); if (r && r.expiresAt > Date.now()) out.push(r); }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8 || password.length > 200) throw new HttpError(400, "weak_password");
}
