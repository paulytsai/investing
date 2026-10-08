import { json, handler, param, query, HttpError } from "../lib/http.mjs";
import { currentUser } from "../lib/entitlement.mjs";
import { checkoutUrl, portalUrl } from "../lib/billing.mjs";

export default handler(async (req, context) => {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, "unauthenticated");
  const action = param(context, "action");

  if (action === "checkout") {
    const plan = query(req).get("plan") === "annual" ? "annual" : "monthly";
    const url = await checkoutUrl(user, plan);
    if (!url) throw new HttpError(503, "billing_not_configured");
    return json({ url });
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
