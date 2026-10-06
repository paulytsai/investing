# Company model: web app

The company-model page from the claude.ai artifact, served as a web app with accounts, an admin area and a way to
charge users. The page itself is unchanged: `templates/build.py --web` writes it to `public/app.html` with one extra
script, `web/shim.js`. That script stands in for claude.ai's `window.claude`, so the page reaches the app's own
server for everything it previously got from claude.ai:

| The page asks for | claude.ai gave it | The web app gives it |
| --- | --- | --- |
| `mcp` (FMP, Edgar Tools) | the viewer's connectors | `POST /api/tools`: FMP's REST API and Edgar Tools (or sec.gov directly) with the server's keys, cached |
| `sample` (Claude) | the viewer's Claude | `POST /api/sample`: the Claude API with the server's key, streamed, metered |
| `db` | the artifact's per-user store | `/api/docs`: the signed-in user's saved models, with version history |
| `downloads` | the browser's save dialog | a browser download, counted against the plan |
| `user` | the claude.ai user | the signed-in account |

## Run it

Node 22.5 or later (it uses the built-in `node:sqlite`) and Python 3 for the build.

```sh
cd webapp
npm install
npm run build                 # page.html -> public/app.html (+ the prompts, as version 1 in the prompt registry)
cp .env.example .env          # set OWNER_EMAIL; add FMP_API_KEY for data
npm run fonts                 # optional: the Japanese/Chinese PDF fonts, served locally instead of from jsdelivr
npm start                     # http://localhost:8787
```

Sign in with `OWNER_EMAIL`. Without `RESEND_API_KEY` the six-digit code goes to the dev outbox: the server log and
<http://localhost:8787/dev/mail>. Without `ANTHROPIC_API_KEY`, Claude features answer from a labelled stub; without
`EDGAR_TOOLS_API_KEY`, filings come straight from sec.gov, which requires `SEC_USER_AGENT` (your app name and a contact
email; www.sec.gov refuses anonymous clients). The sec.gov fallback can't produce the geographic revenue breakdown,
which only Edgar Tools provides; the page loads without it.

Tests: `npm test` (server, no network) and `npm run e2e` (a browser smoke test; needs Playwright with Chromium and
either `FMP_FIXTURES` or an FMP key).

## Who can use it

It starts personal. Only the owner (`OWNER_EMAIL`) can sign in, and only the owner can receive FMP or Claude output,
until the owner records the FMP display licence in **Admin → Settings**. That matches FMP's terms for a personal key:
redistributing its data to other people needs a data display licence. After that, invited emails (Admin →
Allowlist) can sign in; open sign-ups are a separate switch.

Billing stays off until the display licence **and** a legal check are recorded, and then the owner switches it on.
While billing is off, invited users are on the complimentary plan.

## Plans and what's metered

| Plan | Companies a month | Saved models | Notes drafts | Translations | Guidance reads | Segment fills | Downloads | Claude budget (soft / hard) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Free | 3 | 3 | – | – | – | – | 5 | none |
| Trial (14 days, card) | 8 | 20 | 2 | 2 | 20 | 1 | 10 | $3 / $4 |
| Plus | 30 | 150 | 6 | 6 | 100 | 4 | 100 | $10 / $15 |
| Pro | 120 | 1,000 | 25 | 25 | 400 | 15 | 500 | $30 / $45 |

The limits live in the `plans` table and are edited in Admin → Plans. A company counts once per period, however
often it's reloaded. A segment fill or a guidance read counts once per run (it may read several filings). Every
FMP, SEC and Claude call is written to `usage_events` with its cost, so the admin area shows cost against revenue
per user. There's also a global daily Claude budget (Admin → Settings) that pauses Claude for everyone but the owner.

## Claude

`/api/sample` accepts only the page's own prompts: it recognises each request by the prompt it starts with (call
summary, notes draft, translation, segment tables, guidance from a release or a call), so the endpoint can't be used
as a general Claude proxy. Each prompt site has a model, effort and token limit in the prompt registry
(Admin → Prompts); version 1 is the text in `page.html`, and an activated newer version replaces it on the server.
Requests use `claude-opus-5-5` with the server-side refusal fallback (`fallbacks: "default"`). JSON answers (call
summaries, segment tables, guidance) are cached for 90 days. The notes prompt is the neutral one: no buy/sell calls,
no price targets.

The app reads `ANTHROPIC_API_KEY` and `CLAUDE_BASE_URL` only. It deliberately ignores `ANTHROPIC_BASE_URL`, so it
can't pick up another tool's settings on the same machine.

## Security notes

- Sessions are random tokens in an HttpOnly, SameSite=Lax cookie; only their SHA-256 is stored.
- Writes must come from the app's own origin as JSON, which blocks cross-site form posts.
- The admin area needs an authenticator code (TOTP) in the session (`REQUIRE_ADMIN_MFA`, on by default).
- The page is served with a Content-Security-Policy that allows its two inline scripts by hash, the export
  libraries from cdnjs and Google Fonts, and nothing else.
- API keys stay on the server. The FMP and Edgar routes accept only the endpoints and parameters the page uses.
- Signing out, or a different user signing in on the same browser, clears the page's browser copy of saved models.
- Users can delete their own account from the account menu (after cancelling any subscription). Saved models and
  sign-in data are deleted; usage records stay, without the user, for cost accounting. A database copy is made
  daily into `data/backups/` (14 kept).

## Layout

```
server/
  index.js        start the server        app.js     routes, CSP, static pages
  config.js       settings from .env      db.js      SQLite, seed data (plans, prices, flags, prompts)
  schema.sql      tables (Postgres-compatible types, so a move to Postgres is a port, not a redesign)
  auth.js         email codes, sessions, roles, TOTP     meter.js   plans, limits, usage, Claude budgets
  docs.js         saved models            http.js    errors, origin check, rate limits
  tools/          FMP proxy, Edgar Tools and sec.gov     claude/    the Claude endpoint, its stub
  admin/          admin API               billing/   Stripe Checkout, portal, webhook
  dq/             data-quality checks (FMP against SEC XBRL)          jobs.js    timers
web/
  shim.js         window.claude for the page, sign-in screen, account menu
  admin/          the admin area          account/   plans and billing
test/             node:test suites, e2e/smoke.mjs
```
