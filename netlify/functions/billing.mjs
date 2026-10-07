import { json, handler, param, HttpError } from "../lib/http.mjs";
import { currentUser } from "../lib/entitlement.mjs";
import { checkoutUrl, freshPortalUrl } from "../lib/lemonsqueezy.mjs";

export default handler(async (req, context) => {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, "unauthenticated");
  const action = param(context, "action");

  if (action === "checkout") {
    const url = checkoutUrl(user);
    if (!url) throw new HttpError(503, "billing_not_configured");
    return json({ url });
  }
  if (action === "portal") {
    const sub = user.subscription;
    if (!sub?.id) throw new HttpError(404, "no_subscription");
    const url = (await freshPortalUrl(sub.id)) || sub.portalUrl;
    if (!url) throw new HttpError(404, "no_portal_url");
    return json({ url });
  }
  throw new HttpError(404, "not_found");
});

export const config = { path: "/api/billing/:action" };
