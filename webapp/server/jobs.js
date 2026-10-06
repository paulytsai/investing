// Background jobs on timers (one process): expired sessions and codes, cache pruning.
export function startJobs(db) {
  const hourly = () => {
    try {
      const now = Date.now();
      db.run("DELETE FROM sessions WHERE expires_at_ms < ?", now);
      db.run("DELETE FROM login_codes WHERE expires_at_ms < ?", now - 864e5);
      db.run("DELETE FROM fmp_cache WHERE expires_at_ms < ?", now - 7 * 864e5);
      db.run("DELETE FROM claude_cache WHERE expires_at_ms < ?", now);
    } catch (e) { console.error("[jobs]", e); }
  };
  hourly();
  setInterval(hourly, 3600e3).unref();
}
