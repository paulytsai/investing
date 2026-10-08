import { json, error, readJson, handler, param, HttpError } from "../lib/http.mjs";
import { createUser, findUserByLogin, findUserByEmail, verifyPassword, hashPassword, validatePassword, publicUser, saveUser, loginBuiltin, deleteUser, createResetToken, consumeResetToken } from "../lib/users.mjs";
import { sendMail, mailConfigured } from "../lib/mail.mjs";
import { logEvent, DEV_COOKIE } from "../lib/events.mjs";
import { cancelSubscription } from "../lib/billing.mjs";
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
    await logEvent("signup", { user, req });
    const token = createToken({ uid: user.id });
    return json(userResponse(user), 201, { "set-cookie": sessionCookie(token, req) });
  }

  if (action === "login" && req.method === "POST") {
    const body = await readJson(req);
    let user = await findUserByLogin(body.login || body.email || body.username);
    if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) {
      user = await loginBuiltin(body.login || body.username, String(body.password || ""));
      if (!user) throw new HttpError(401, "invalid_credentials");
    }
    await logEvent("login", { user, req });
    const token = createToken({ uid: user.id });
    const headers = new Headers({ "set-cookie": sessionCookie(token, req) });
    if (user.role === "admin") headers.append("set-cookie", DEV_COOKIE + (new URL(req.url).protocol === "https:" ? "; Secure" : ""));
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("cache-control", "no-store");
    return new Response(JSON.stringify(userResponse(user)), { status: 200, headers });
  }

  if (action === "logout" && req.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  }

  // Beginner ("simple") or full page layout, remembered on the account.
  if (action === "view" && req.method === "POST") {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, "unauthenticated");
    const body = await readJson(req);
    if (!["simple", "full"].includes(body.view)) throw new HttpError(400, "invalid_view");
    user.view = body.view;
    await saveUser(user);
    return json(userResponse(user));
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

  if (action === "cancel-subscription" && req.method === "POST") {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, "unauthenticated");
    if (!user.subscription?.id) throw new HttpError(404, "no_subscription");
    const updated = await cancelSubscription(user);
    if (!updated) throw new HttpError(503, "billing_not_configured", "Cancel from the billing portal");
    user.subscription = updated;
    await saveUser(user);
    await logEvent("cancel", { user, req });
    return json(userResponse(user));
  }

  if (action === "delete-account" && req.method === "POST") {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, "unauthenticated");
    const body = await readJson(req);
    if (!verifyPassword(String(body.password || ""), user.passwordHash)) throw new HttpError(401, "invalid_credentials");
    if (user.builtin) throw new HttpError(400, "builtin_account");
    if (user.subscription?.id && ["active", "on_trial", "past_due"].includes(user.subscription.status)) {
      try { await cancelSubscription(user.subscription.id); } catch (e) { console.warn("cancel on delete failed", e.message); }
    }
    await logEvent("delete_account", { user, req });
    await deleteUser(user);
    return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  }

  if (action === "change-password" && req.method === "POST") {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, "unauthenticated");
    if (user.builtin) throw new HttpError(400, "builtin_account");
    const body = await readJson(req);
    if (!verifyPassword(String(body.currentPassword || ""), user.passwordHash)) throw new HttpError(401, "invalid_credentials");
    validatePassword(body.newPassword);
    user.passwordHash = hashPassword(body.newPassword);
    user.passwordChangedAt = new Date().toISOString();
    await saveUser(user);
    await logEvent("change_password", { user, req });
    return json({ ok: true });
  }

  if (action === "forgot" && req.method === "POST") {
    // Always answer the same way so the form does not reveal whether an address is registered.
    const body = await readJson(req);
    const user = await findUserByEmail(String(body.email || "").trim());
    if (user && !user.builtin) {
      const token = await createResetToken(user);
      const link = `${cfg.siteUrl().replace(/\/$/, "")}/#/reset/${token}`;
      const ja = user.locale === "ja", zh = user.locale === "zh-TW";
      const subject = ja ? "パスワード再設定のご案内" : zh ? "重設密碼" : "Reset your password";
      const text = ja ? `パスワードを再設定するには、1時間以内に次のリンクを開いてください。\n\n${link}\n\n心当たりがない場合は、このメールを無視してください。`
        : zh ? `請在1小時內開啟下列連結以重設密碼。\n\n${link}\n\n若非您本人操作，請忽略此郵件。`
        : `Open this link within one hour to choose a new password.\n\n${link}\n\nIf you did not ask for this, ignore this email.`;
      try { await sendMail({ to: user.email, subject, text }); } catch (e) { console.error("reset mail failed", e.message); }
      await logEvent("forgot_password", { user, req });
    }
    return json({ ok: true, mail: mailConfigured() });
  }

  if (action === "reset" && req.method === "POST") {
    const body = await readJson(req);
    validatePassword(body.password);
    const user = await consumeResetToken(String(body.token || ""));
    if (!user) throw new HttpError(400, "invalid_token");
    user.passwordHash = hashPassword(body.password);
    user.passwordChangedAt = new Date().toISOString();
    await saveUser(user);
    await logEvent("reset_password", { user, req });
    const token = createToken({ uid: user.id });
    return json(userResponse(user), 200, { "set-cookie": sessionCookie(token, req) });
  }

  return error(404, "not_found");
});

export const config = { path: "/api/auth/:action" };
