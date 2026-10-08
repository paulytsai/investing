import { json, handler, param, query, HttpError } from "../lib/http.mjs";
import { currentUser } from "../lib/entitlement.mjs";
import { checkoutUrl, portalUrl, lookupCoupon } from "../lib/billing.mjs";

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
  // GET /api/billing/coupon?code=  checks a code before checkout so the site can show the discount
  if (action === "coupon") {
    const c = await lookupCoupon(query(req).get("code"));
    if (!c) throw new HttpError(404, "invalid_coupon");
    return json({ coupon: c });
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
