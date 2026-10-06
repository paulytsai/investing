// Background jobs on timers (one process): expired sessions and codes, cache pruning, a daily database backup and the
// nightly data-quality check.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { runNightlyDq } from "./dq/index.js";
import { pruneSecCache } from "./tools/sec.js";

const KEEP_BACKUPS = 14;
// a consistent copy of the live database (VACUUM INTO works while the app is running), one per day
export function backupDb(db, dir = path.join(config.dataDir, "backups")) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "app-" + new Date().toISOString().slice(0, 10) + ".db");
  if (fs.existsSync(file)) return file;
  db.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'");
  const old = fs.readdirSync(dir).filter((f) => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -KEEP_BACKUPS);
  for (const f of old) fs.rmSync(path.join(dir, f));
  return file;
}
export function startJobs(db) {
  const hourly = () => {
    try {
      const now = Date.now();
      db.run("DELETE FROM sessions WHERE expires_at_ms < ?", now);
      db.run("DELETE FROM login_codes WHERE expires_at_ms < ?", now - 864e5);
      db.run("DELETE FROM fmp_cache WHERE expires_at_ms < ?", now - 7 * 864e5);
      db.run("DELETE FROM claude_cache WHERE expires_at_ms < ?", now);
      pruneSecCache(db);
    } catch (e) { console.error("[jobs]", e); }
    try { backupDb(db); } catch (e) { console.error("[backup]", e); db.logError("backup", "failed", e?.message || String(e)); }
  };
  hourly();
  setInterval(hourly, 3600e3).unref();
  // data quality: once a day, about an hour after start and then every 24 hours
  const nightly = () => runNightlyDq(db).catch((e) => console.error("[dq]", e));
  setTimeout(() => { nightly(); setInterval(nightly, 864e5).unref(); }, 3600e3).unref();
}
