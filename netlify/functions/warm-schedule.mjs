// Hourly scheduled trigger: kicks off one background warm run.
import { cfg } from "../lib/config.mjs";

export default async () => {
  const url = `${cfg.siteUrl().replace(/\/$/, "")}/.netlify/functions/warm-background`;
  const res = await fetch(url, { method: "POST", headers: { "x-internal-secret": cfg.internalSecret() } });
  return new Response(`warm dispatched: ${res.status}`, { status: 200 });
};

export const config = { schedule: "17 * * * *" };
