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
