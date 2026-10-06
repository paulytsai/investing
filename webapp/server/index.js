// Starts the web app: node server/index.js (npm start). Settings come from .env (see .env.example).
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { startJobs } from "./jobs.js";

const db = openDb();
const app = createApp(db);
startJobs(db);
serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Company model web app on ${config.baseUrl} (port ${info.port})`);
  console.log(`  owner: ${config.ownerEmail || "(OWNER_EMAIL not set)"}   FMP: ${config.fmpFixtures ? "fixtures" : config.fmpApiKey ? "API key" : "no key"}   Claude: ${config.claudeStub ? "stub" : "API"}   mail: ${config.resendApiKey ? "Resend" : "dev outbox"}`);
});
