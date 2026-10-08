// Hourly scheduled trigger: dispatches one background warm run (sharded).
import { dispatchWarm } from "../lib/warmer.mjs";

export default async () => {
  const r = await dispatchWarm({ full: false });
  return new Response(`warm dispatched: ${JSON.stringify(r)}`, { status: 200 });
};

export const config = { schedule: "17 * * * *" };
