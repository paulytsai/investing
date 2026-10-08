import { json, handler, param, query, HttpError } from "../lib/http.mjs";
import { currentUser } from "../lib/entitlement.mjs";
import { checkoutUrl, portalUrl, lookupCoupon } from "../lib/billing.mjs";
import { getAccessCode, accessCodeProblem, redeemAccessCode } from "../lib/coupons.mjs";
import { entitlement } from "../lib/entitlement.mjs";
import { publicUser } from "../lib/users.mjs";
import { logEvent } from "../lib/events.mjs";

export default handler(async (req, context) => {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, "unauthenticated");
  const action = param(context, "action");

  if (action === "checkout") {
    const plan = query(req).get("plan") === "annual" ? "annual" : "monthly";
    const code = (query(req).get("coupon") || "").trim();
    let promotionCode = null;
    if (code) {
      const c = await lookupCoupon(code);
      if (!c) throw new HttpError(400, "invalid_coupon");
      promotionCode = c.id;
    }
    const url = await checkoutUrl(user, plan, promotionCode);
    if (!url) throw new HttpError(503, "billing_not_configured");
    return json({ url });
  }
  // GET /api/billing/coupon?code=  checks a code: a site access code (free months, no card) or a
  // Stripe promotion code (discount applied at checkout).
  if (action === "coupon") {
    const code = query(req).get("code");
    const a = await getAccessCode(code);
    if (a) {
      const problem = accessCodeProblem(a, user);
      if (problem) throw new HttpError(problem === "coupon_used" ? 409 : 404, problem);
      return json({ coupon: { kind: "access", code: a.code, months: a.months } });
    }
    const c = await lookupCoupon(code);
    if (!c) throw new HttpError(404, "invalid_coupon");
    return json({ coupon: { kind: "stripe", ...c } });
  }
  // POST /api/billing/redeem?code=  extends the free period by the code's months
  if (action === "redeem" && req.method === "POST") {
    const r = await redeemAccessCode(user, query(req).get("code"));
    await logEvent("coupon", { user, detail: `${r.months}m`, req });
    return json({ user: publicUser(r.user), entitlement: entitlement(r.user), until: r.until, months: r.months });
  }
  if (action === "portal") {
    if (!user.subscription?.id) throw new HttpError(404, "no_subscription");
    const url = await portalUrl(user);
    if (!url) throw new HttpError(404, "no_portal_url");
    return json({ url });
  }
  throw new HttpError(404, "not_found");
});

export const config = { path: "/api/billing/:action" };
