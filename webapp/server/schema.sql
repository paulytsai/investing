-- Company model web app schema (SQLite for the prototype; every table maps one-to-one to Postgres).
-- JSON is stored as TEXT. Times are ISO-8601 UTC strings unless named *_ms.

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

-- identity and access -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'user')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  locale TEXT,
  trial_used INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT,
  totp_enrolled INTEGER NOT NULL DEFAULT 0,
  totp_last_step INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS allowlist (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'user')),
  invited_by TEXT,
  invited_at TEXT NOT NULL,
  accepted_at TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE,
  code_hash TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS login_codes_email ON login_codes (email, id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,               -- sha256 of the cookie token; the token itself is never stored
  user_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  aal INTEGER NOT NULL DEFAULT 1,    -- 2 after a TOTP check in this session
  aal_at INTEGER,                    -- when that check happened (ms); the step-up lasts ADMIN_STEP_UP_HOURS
  created_at TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  last_seen_at TEXT,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

-- settings and switches -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_flags (
  user_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  key TEXT NOT NULL REFERENCES feature_flags (key) ON DELETE CASCADE,
  enabled INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- user data (the artifact's data/users/<uid> collection) --------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_docs (
  user_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL,
  kind TEXT NOT NULL,                -- model | sec | calls | other (from the id prefix)
  ticker TEXT,
  json TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  updated_at_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, doc_id)
);

CREATE TABLE IF NOT EXISTS user_docs_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  json TEXT NOT NULL,
  saved_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS user_docs_history_doc ON user_docs_history (user_id, doc_id, id);

-- caches (server only) ------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fmp_cache (
  key TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  params TEXT NOT NULL,
  ticker TEXT,
  body TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  last_hit_at TEXT
);
CREATE INDEX IF NOT EXISTS fmp_cache_ticker ON fmp_cache (ticker);

CREATE TABLE IF NOT EXISTS sec_cache (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ticker TEXT,
  body TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS claude_cache (
  key TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  prompt_version_id INTEGER,
  ticker TEXT,
  user_id TEXT,
  response TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL
);

-- prompts (admin only; versioned) -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prompts (
  site TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  json_site INTEGER NOT NULL DEFAULT 0,
  active_version_id INTEGER
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL REFERENCES prompts (site),
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT,
  max_tokens INTEGER NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (site, version)
);

-- metering ------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_prices (
  model TEXT NOT NULL,
  input_per_mtok REAL NOT NULL,
  output_per_mtok REAL NOT NULL,
  cache_write_per_mtok REAL NOT NULL,
  cache_read_per_mtok REAL NOT NULL,
  effective_from TEXT NOT NULL,
  PRIMARY KEY (model, effective_from)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT,
  feature TEXT NOT NULL,             -- company_load | fmp | sec | claude | export | import
  site TEXT,                         -- Claude prompt site
  provider TEXT NOT NULL,            -- fmp | sec | edgar_tools | anthropic | stub | app
  ticker TEXT,
  endpoint TEXT,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  model TEXT,
  prompt_version_id INTEGER,
  cost_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  ms INTEGER
);
CREATE INDEX IF NOT EXISTS usage_events_user_at ON usage_events (user_id, at);
CREATE INDEX IF NOT EXISTS usage_events_at ON usage_events (at);

CREATE TABLE IF NOT EXISTS usage_period (
  user_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  company_loads INTEGER NOT NULL DEFAULT 0,
  drafts INTEGER NOT NULL DEFAULT 0,
  translations INTEGER NOT NULL DEFAULT 0,
  guidance INTEGER NOT NULL DEFAULT 0,
  segment_fills INTEGER NOT NULL DEFAULT 0,
  exports INTEGER NOT NULL DEFAULT 0,
  claude_usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period_start)
);

CREATE TABLE IF NOT EXISTS period_tickers (
  user_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  ticker TEXT NOT NULL,
  first_at TEXT NOT NULL,
  PRIMARY KEY (user_id, period_start, ticker)
);

-- billing (inert until billing is switched on) ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,               -- owner | comp | free | trial | plus | pro
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  limits TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS plan_prices (
  id TEXT PRIMARY KEY,               -- Stripe price id
  plan_id TEXT NOT NULL REFERENCES plans (id),
  interval TEXT NOT NULL CHECK (interval IN ('month', 'year')),
  lookup_key TEXT,
  currency_options TEXT NOT NULL,    -- {"usd": 2400, "jpy": 3600, "twd": 75000} in minor units
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS customers (
  user_id TEXT PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  stripe_customer_id TEXT UNIQUE,
  country TEXT,
  currency TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  plan_id TEXT,
  price_id TEXT,
  currency TEXT,
  interval TEXT,
  unit_amount INTEGER,
  current_period_start TEXT,
  current_period_end TEXT,
  trial_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  canceled_at TEXT,
  grace_until TEXT,
  last_event_created INTEGER,
  livemode INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL,
  raw TEXT
);
CREATE INDEX IF NOT EXISTS subscriptions_user ON subscriptions (user_id);

CREATE TABLE IF NOT EXISTS subscription_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,                -- new | upgrade | downgrade | churn | reactivate
  from_plan TEXT,
  to_plan TEXT,
  from_mrr_usd REAL,
  to_mrr_usd REAL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  subscription_id TEXT,
  status TEXT NOT NULL,
  currency TEXT,
  amount_due INTEGER,
  amount_paid INTEGER,
  tax INTEGER,
  created_at TEXT NOT NULL,
  hosted_invoice_url TEXT,
  raw TEXT
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  livemode INTEGER NOT NULL,
  created INTEGER NOT NULL,
  status TEXT NOT NULL,              -- received | processed | ignored | failed
  received_at TEXT NOT NULL,
  processed_at TEXT,
  error TEXT,
  payload TEXT
);

CREATE TABLE IF NOT EXISTS comps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans (id),
  until TEXT,
  granted_by TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

-- logs and data quality -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  before TEXT,
  after TEXT
);

CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  source TEXT NOT NULL,
  code TEXT,
  message TEXT,
  user_id TEXT,
  ticker TEXT,
  context TEXT
);

CREATE TABLE IF NOT EXISTS dq_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL UNIQUE,
  at TEXT NOT NULL,
  ticker TEXT NOT NULL,
  kind TEXT NOT NULL,                -- sec_mismatch | segment_label | segment_sum | claude_json | user_report
  field TEXT,
  period TEXT,
  fmp_value TEXT,
  sec_value TEXT,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'fixed', 'wontfix')),
  note TEXT,
  updated_by TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS ticker_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  kind TEXT NOT NULL,                -- geo_label | product_label
  rule TEXT NOT NULL,                -- {"from": "Other Americas", "to": "Asia Pacific & Latin America"}
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dev_mail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL
);
