import { json, error, readJson, handler, param, HttpError } from "../lib/http.mjs";
import { createUser, findUserByLogin, verifyPassword, publicUser, saveUser } from "../lib/users.mjs";
import { createToken, sessionCookie, clearCookie } from "../lib/session.mjs";
import { currentUser, entitlement } from "../lib/entitlement.mjs";
import { cfg, SUPPORTED_LOCALES } from "../lib/config.mjs";

function userResponse(user) {
  return { user: publicUser(user), entitlement: entitlement(user) };
}

export default handler(async (req, context) => {
  const action = param(context, "action");

  if (action === "me" && req.method === "GET") {
    const user = await currentUser(req);
    if (!user) return json({ user: null, entitlement: null });
    return json(userResponse(user));
  }

  if (action === "signup" && req.method === "POST") {
    const body = await readJson(req);
    const locale = SUPPORTED_LOCALES.includes(body.locale) ? body.locale : cfg.defaultLocale();
    const user = await createUser({ username: String(body.username || "").trim(), email: String(body.email || "").trim(), password: body.password, locale });
    const token = createToken({ uid: user.id });
    return json(userResponse(user), 201, { "set-cookie": sessionCookie(token, req) });
  }

  if (action === "login" && req.method === "POST") {
    const body = await readJson(req);
    const user = await findUserByLogin(body.login || body.email || body.username);
    if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) {
      throw new HttpError(401, "invalid_credentials");
    }
    const token = createToken({ uid: user.id });
    return json(userResponse(user), 200, { "set-cookie": sessionCookie(token, req) });
  }

  if (action === "logout" && req.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  }

  if (action === "locale" && req.method === "POST") {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, "unauthenticated");
    const body = await readJson(req);
    if (!SUPPORTED_LOCALES.includes(body.locale)) throw new HttpError(400, "invalid_locale");
    user.locale = body.locale;
    await saveUser(user);
    return json(userResponse(user));
  }

  return error(404, "not_found");
});

export const config = { path: "/api/auth/:action" };
