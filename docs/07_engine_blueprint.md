## §8 Engine blueprint

This section is an **engineering proposal**. It is not part of Paul's philosophy. Everything the engine *decides* must come from §3 (decision system), §7 (compliance), the invariants INV-1…INV-7, and `config/philosophy.yaml`. Where the engine needs a policy Paul has not set, the blueprint points to the §10 decision (D-xx) instead of choosing one.

### 8.1 Purpose and scope

**What the engine does**
1. **Research.** Runs Paul's ten-stage pipeline (§4.1) on a name and produces the structured artifacts: `ThesisRecord`, `FinancialRead`, `MoatAssessment`, `GateResult`, `ValuationRecord`, `LensVerdicts`, `PositionDecision`. It can also render a one-page brief in the format of his `investment-research-brief` skill (key facts, how it makes money, cost structure, moat, what drives the stock, latest quarter, big moves, four lenses, the tension).
2. **Monitoring.** Tracks every holding's `thesis_status`, its dated 点検材料 checkpoints, the premise register (§6.4), the macro dashboard (§6.2) and portfolio health (survival, concentration, barbell balance). It raises alerts according to the rules.
3. **Decision support.** Proposes actions (research task, hold, staged add, trim, exit, switch, publish an idea). Each proposal carries its encoding (HARD / SOFT / ALERT / GATE) and the rule IDs behind it. **It never executes.**
4. **Newsletter support.** Drafts Japanese text for the RP, 投資アイデア, Q&A and column channels. Every draft passes the compliance lint (§7). Drafts only; the engine never publishes.
5. **Audit and learning.** Keeps the hypothesis ledger, the process scores and standardized performance reporting, and runs a decision-replay test suite against Paul's documented decisions.

**Non-goals**
- Autonomous trading.
- Price-only signals: no stop-losses, no %-drop buys, no %-gain trims (INV-3).
- Chart-driven strategies. Technicals are at most an entry-pacing overlay, per D-28.
- Macro-driven selling of thesis-intact names.
- Publishing anything.

**Users and books**
- Paul is the PM and the only approver.
- Two books may exist: the Recommended Portfolio (RP) and Paul's personal book. Which one the engine optimizes, and whether both are tracked, is decision **D-11**. Until Paul decides, treat both as read-only, and send every proposal on either book to GATE(Paul).
- Readers are never users. They receive frameworks through Paul's newsletter (INV-6).

### 8.2 Architecture

```mermaid
flowchart LR
  subgraph Sources
    IBKR[IBKR read-only\npositions, prices, performance]
    EDGAR[SEC EDGAR\n10-K/10-Q/8-K, XBRL facts,\nForm 4, DEF 14A]
    TR[Earnings-call transcripts\n+ IR decks]
    FRED[FRED / macro series\nyields, CPI, mortgage, USDJPY]
    CMDTY[Oil & uranium curves\n(source TBD)]
    CORPUS[Paul's own corpus\nnewsletters, columns]
  end
  CFG[(config/philosophy.yaml\n+ rules/*.yaml)]
  STORE[(State store\nSQLite/Postgres + Parquet)]
  RA[Research agent\nLLM, source-restricted]
  FW[Frameworks library\ndeterministic calculators]
  RE[Rules engine\nHARD > GATE > ALERT > SOFT]
  SM[Thesis state machine]
  MON[Monitors & schedulers]
  PROP[Proposals & alerts inbox]
  PAUL{{Paul approval\nDecisionRecord}}
  COMMS[Comms: JP drafts\n+ compliance lint]
  AUD[Audit: ledger, replay,\nperformance]

  Sources --> STORE
  STORE --> RA --> STORE
  STORE --> FW --> RE
  CFG --> RE
  RE --> SM --> STORE
  MON --> RE
  RE --> PROP --> PAUL
  PAUL --> STORE
  PAUL --> COMMS
  STORE --> AUD
```

**Modules** (suggested package `src/engine/`):

| Module | Responsibility | Key spec references |
|---|---|---|
| `config` | Load and validate `philosophy.yaml`. Detect `TBD(Paul)` values and expose them as unresolved decisions (D-IDs). Version every change (`ConfigVersion`). | §9, INV-5 |
| `connectors` | Clients for IBKR (read-only), EDGAR, transcripts, FRED, FX/commodities and the corpus. | §8.3 |
| `store` | Entities (§8.4) with an event-sourced `EventLog`. Time series live in Parquet or DuckDB. | §8.4 |
| `research` | Pipeline stages 1–10 as LLM-assisted steps with typed outputs. Enforces source discipline. | §4.1, §8.7 |
| `frameworks` | Deterministic calculators (§8.5): operating leverage, EPS-vs-multiple move split, own-history PER band, hurdle test, 領収書 conversion, 点灯率, asymmetry, EV vs range, CAGR. | §4.2–4.4 |
| `rules` | Compile R-/X-/C-/INV- rules from YAML. Evaluate them into typed `Action`s with encodings. | §3.2, §3.3, §3.6, §7 |
| `state` | The `thesis_status` machine, transition guards and suppression list (§3.1). | §3.1 |
| `monitor` | Schedulers for the earnings calendar, checkpoint due dates, premise cadence, macro refresh, portfolio health and the crisis detector. | §3.5, §6 |
| `comms` | Japanese draft builders per channel, templates, the forbidden-phrase lint and fair-disclosure insertion. | §7 |
| `audit` | `DecisionRecord`, `HypothesisLedger`, `ReviewLog`, performance and the decision-replay suite. | §5.4, §8.9 |
| `ui` | CLI plus Markdown/HTML reports: weekly brief, holdings dashboard, alerts inbox, decision queue. | — |

### 8.3 Data sources

| Source | Use | Notes |
|---|---|---|
| **IBKR** (the MCP connector if configured in Claude Code, otherwise the Client Portal/TWS API) | Positions, balances, price history and snapshots, contract search, themes, account performance (`get_pa_performance_all_periods`), watchlists, price alerts | **Read-only by default.** Order tools (`create_order_instruction`, `delete_order_instruction`) are disabled in config and must never be called without an explicit per-order instruction from Paul. Creating watchlists or alerts also needs his approval. |
| **SEC EDGAR** | 10-K/10-Q/8-K, XBRL company facts (≥10 years of BS/CF/P&L), DEF 14A (pay and ownership), Form 4 (insider buying), 13F where relevant | Primary source for revenue model, segments and cost structure. Use the 10-K's own segment names. |
| **Earnings-call transcripts and IR decks** | Guidance, KPIs, management tone, bull/bear variables | Provider TBD. Paul reads transcripts and CEO interviews, and names YouTube interviews with auto-captions as usable. |
| **FRED** | DGS2, DGS10, DGS30, T-bill yields, MORTGAGE30US, CPIAUCSL, DEXJPUS and similar | §6.2 maps each indicator. Series codes there are suggested mappings. |
| **Commodities** | WTI/Brent spot and the futures curve (contango vs backwardation), uranium price | Provider TBD (EIA for spot; the futures curve needs a market-data source). |
| **Corpus** | Paul's newsletters, columns and notes, used for retrieval (what he previously said about a name or premise) | Apply the §11 blocklist: never learn numbers from flagged passages. |

### 8.4 Data model

The field lists below are suggestions that render Paul's categories (see §3.1 and §4.1). Enums use the exact values from §3.1.

| Entity | Key fields |
|---|---|
| `Instrument` | ticker, name, exchange, region, sector, `asset_type` {non_commodity, commodity_cyclical, miner_resource, real_estate, fund_etf, bond_cash}, `ai_layer` {upstream, midstream_receipts, midstream_reseller, downstream_tollbooth, none}, reader_access flags, substitutes (e.g., URA for CCJ) |
| `Position` | instrument, book {RP, personal}, weight, since, `role` {core_growth, barbell_insurance, ai_upstream, stable_income, weed, speculative, trade, idea_outside_RP}, `bucket` {spendable_yen, emergency, growth_usd, speculative}, sleeve, `conviction` {low, mid, high} |
| `IdeaCandidate` | as §4.1 (source_channel, theme, trigger_note, tier = 注目) |
| `ThesisRecord` | as §4.1: story_one_line, evidence, break_conditions, main_character, drivers, why_bought, edge_statement, horizon_years, confidence_label, `thesis_status` {intact, monitor, inspection_list, re_evaluate, broken}, plus a status history with timestamps and triggering evidence |
| `FinancialRead`, `MoatAssessment`, `GateResult`, `ValuationRecord`, `LensVerdicts`, `PositionDecision` | as §4.1 |
| `Checkpoint` (点検材料) | premise, KPI, source, next_date, bull_threshold, bear_threshold (usually `TBD(Paul)`), last_reading, status |
| `EventLog` | event_type {earnings, people, bad_news, sharp_drop, crisis, macro, filing}, payload, protocol run, answers, resulting status (append-only) |
| `Premise` | id (§6.4 PR-xx), statement, status {standing, inspection, retracted}, confirming and refuting evidence, linked indicators, review cadence |
| `IndicatorReading` | series_id, date, value, source |
| `Alert` | rule_id, encoding, severity, message, entity refs, missing D-IDs (if caused by TBD), created, resolved_by, resolution |
| `Proposal` | type {research, hold, staged_add, trim, exit, switch, publish_idea, draft_text}, book, rationale (rule IDs, evidence refs), required gate, status |
| `DecisionRecord` | proposal_id, Paul's decision and notes, date, compliance implications (e.g., whether a formal recommendation starts a trading-restriction window; details `TBD(Paul/Diamond)`, D-78) |
| `NewsletterDraft` | channel {RP, IA, QA, column}, text_ja, template ids used, lint results, fair-disclosure present, approval status |
| `PerformanceRecord` | date, book, base currency, benchmark, method {CAGR, simple} (see §5.4, D-62) |
| `ConfigVersion` | hash, date, author, diff, resolved D-IDs |

### 8.5 Frameworks library: what to compute deterministically

Implement these as pure functions with unit tests. The LLM supplies inputs from filings; the functions do the arithmetic, never the LLM (§11: recompute every quoted number).

- **Operating leverage:** ΔOperating income ÷ ΔRevenue, and the EPS/price impact of a ±1% revenue scenario (F-81).
- **Move decomposition:** price change split into EPS change and multiple change. A multiple-only collapse with the thesis intact makes the name a candidate (F-12).
- **Own-history valuation band:** about 10 years of PER (or EV/EBITDA, P/S by business type, F-15), with the current percentile (F-13). Also PEG and relative P/E (F-14).
- **Hurdle test:** expected return (yield + growth − loss risk) vs the T-bill/MMF or 10-year yield (F-18). The margin is `TBD(Paul)`.
- **Asymmetry:** downside floor (yield, deal price, NAV/PV-10, contracts, net cash, prior trough) vs upside (prior peak/trend, peer re-rating, sum of parts), plus the prize-prepaid check (F-76, F-24).
- **Expected value vs range of outcomes:** the answer-sheet model from the risk column (F-77's two questions). Report both the EV and the dispersion; never EV alone.
- **領収書付きCapEx:** backlog (RPO) → revenue conversion rate over time for AI-infrastructure sellers (§4.4).
- **点灯率 (utilization)**, backlog growth and power prices: the three AI dials (F-45) whenever data exists.
- **Survival check (INV-4):** would a zero on this name, or a −50% market, force a sale or change the owner's life? Needs the sizing inputs D-01 and D-04.
- **Returns:** CAGR and simple annualization side by side, labeled. Paul's historical 「年率」 figures are simple (§5.4, §11).

### 8.6 Rule representation and evaluation

Rules live in `rules/*.yaml`, one entry per R-, X-, C- or INV- ID, keeping the spec's IDs and provenance. Example (illustrative encoding of existing rules; parameters come from config):

```yaml
- id: R-27
  title: Add on a dip only when the thesis is intact
  when:
    all:
      - event: price_drawdown            # a drawdown triggers classification, never a buy by itself (INV-3)
      - thesis_status: intact
      - shock_classification: not_thesis_relevant
  then:
    action: propose_staged_add
    encoding: GATE_PAUL                  # any RP add = GATE(Paul) (INV-1); personal book per D-11
    params: [entry.staged_tranches, sizing.max_position_pct]
  provenance: "§3.2 R-27 · Core"

- id: INV-5
  title: No invented thresholds
  when: { any_param_value: "TBD(Paul)" }
  then: { action: downgrade_to_alert_and_gate, encoding: ALERT, attach: missing_decision_ids }
```

**Evaluation order for each event**
1. Invariants (HARD).
2. Exclusions (X-list).
3. Research gates G1–G6.
4. The suppression list: evidence that can never move `thesis_status` (§3.1).
5. State transitions.
6. SOFT scores.
7. ALERTs.
8. GATEs.

**Precedence:** HARD > GATE(Paul) > ALERT > SOFT.

**TBD handling:** if an action needs a `TBD(Paul)` parameter, emit an ALERT that names the D-ID(s) and routes to GATE(Paul). Never substitute a "suggested default" unless Paul has approved it and it has been written into config.

**Tensions:** for every T-xx (§10), the engine follows current practice as documented. Where Paul has not decided, it raises an ALERT rather than silently choosing a side.

**Newsletter strings:** every newsletter-bound string runs through the C-05 lint (INV-7), the C-03/C-04 templates, C-07 fair disclosure, and the C-08 候補 ban.

### 8.7 Research-agent policy (LLM)

- **Source discipline:** filings and transcripts first. Every number carries a source and a period, e.g. "(FY2025 10-K)". Anything that cannot be verified is marked "(unverified)". Never fabricate a price move, an estimate or a quote. This mirrors the brief skill's standards and Paul's reader advice to restrict AI research to 10-Ks and call transcripts.
- **Structured outputs only:** each stage returns its typed artifact. Free text is limited to rationale fields.
- **Arithmetic:** send all computations to §8.5 functions and recompute any figure quoted from the corpus (§11).
- **Language:** English for internal records. Japanese newsletter drafts follow Paul's style profile (`reference/PAUL_STYLE_PROFILE.md`) and §7.
- **Memory:** retrieve Paul's prior statements on the name or premise from the corpus, apply the §11 blocklist, and show the dates.

### 8.8 Core workflows

| ID | Workflow | Trigger | Steps (rules) | Output |
|---|---|---|---|---|
| W1 | Weekly cycle | Monday; Friday newsletter | Scan earnings, macro releases and the premise register; build a topic menu; after Paul picks, draft the sections (§7 channels) | Topic menu; newsletter drafts (GATE) |
| W2 | Idea → thesis | New `IdeaCandidate` | Stages 1–8 (§4.1), gates G1–G6, four lenses, `PositionDecision` | Thesis record; brief; optional IA draft (C-07; GATE) |
| W3 | Earnings checkpoint | Earnings date (−7d / +1d) | Pre: list 点検材料 with bull/bear readings. Post: audit numbers vs the thesis KPI (R-42); apply the suppression list; transition state | Updated checkpoints and state; alert if `re_evaluate` |
| W4 | Drawdown protocol | Price drawdown ≥ `TBD(Paul)` (research trigger only) | Research task → three-question triage (R-54) → classify temporary vs structural, demand death vs position clearing → if intact: staged-add proposal plus dip-wording draft (C-03/C-04) | Proposal (GATE) or state change |
| W5 | Crisis mode | Crisis flag (R-102…R-110) | The eight-step playbook (§3.5): cooling-off, classify, crash binary per holding, staged deployment where the story is intact, "RP doesn't move", post-crisis design audit | Crisis report; staged-deployment proposal (GATE) |
| W6 | Premise & macro review | Monthly, or when an indicator crosses a stated line | Update the §6.2 dashboard; re-check the §6.4 premises; move a premise to or from inspection with a disclosure task (R-47, C-10) | Premise report; alerts |
| W7 | Portfolio health | Monthly | Survival check (INV-4); concentration and weight bands (D-01, D-16); barbell balance (D-10); weeds (R-58); opportunity cost vs hurdle (R-59); inspection list | Health report; alerts |
| W8 | Reader Q&A | Question received | Anonymize; map to reader-guidance patterns (RG-xx); draft the answer to the wording rules | Draft (GATE) |
| W9 | Performance & audit | Quarterly | Standardized returns (CAGR, stated basis, benchmark, D-62); hypothesis-ledger review (miss classes); process score; decision-replay run | Audit report |

### 8.9 Evaluation: decision-replay suite

Build `tests/replay/` from the §5 case library. Each case is a frozen snapshot of the evidence Paul had, the engine's expected classification and action, and the actual documented decision. Suggested starter cases:

| Case | Evidence | Expected engine behavior (per the spec) |
|---|---|---|
| NFLX 2022 subscriber slowdown | Price collapse, thesis (content engine and pricing power) intact | Research task → intact → hold or staged add; no sell |
| ORCL, Dec 2025, −40% | RPO doubts, OpenAI concentration, stretched balance sheet | Research (「もっと詳しく調べました」) → `monitor`/`inspection_list` with balance-sheet checkpoints; hold personal position; flag the Bolton weak-balance-sheet tension (T-10) |
| APP, Aug 2026 (<1% revenue miss, −20%) | Model-update delay; trust regime change | Suppression: a small miss alone does not move the thesis → `monitor`; Nov Q3 checkpoint (≥+46% growth with stable installs); non-core sizing |
| Memory names, 2026 | Commodity pricing; EPS peak | `commodity_cyclical` → exit plan on cycle signals (R-57); not core |
| TSMC vs Samsung/SK Hynix | Non-commodity foundry vs commodity memory | Different `asset_type`; TSMC core-eligible |
| ATVI merger arbitrage | Remaining spread ≈5% annualized | Thesis complete + upside capped → exit proposal (GATE) |
| NVDA weight growth | Winner with rising conviction | No auto-trim; rebalance override due to rising conviction (R-91) → ALERT only |
| CVX trim, Feb 2023 | Barbell drift toward energy | Oil trimmed into strength, never to zero (R-95) → GATE |
| SVB, Mar 2023 | Bank-run crisis | 「誰が影響を受け、誰が受けないか」; no uniform sector sell (F-73) |
| Iran shock, Mar 2026 | Geopolitical shock | Crisis-mode steps; 「推奨ポートフォリオは動かないつもりです」 |

**Metrics:** agreement rate with documented decisions; false-alert rate; share of proposals that needed a TBD gate (should fall as §10 decisions are made); lint pass rate.

**Unit tests:** INV-1…INV-7, including that a price-only trigger never produces a trade proposal, that TBD produces an ALERT, and that a banned phrase blocks a draft.

### 8.10 Human-in-the-loop, safety and privacy

- **No execution.** Order tools are disabled at the config and connector levels. Any exception needs Paul's explicit per-order instruction, logged as a `DecisionRecord`.
- **RP governance.** Any RP inclusion, exclusion, weight change or affirmative add-call is GATE(Paul) (INV-1). The `DecisionRecord` notes the compliance implication; the trading-restriction details are `TBD(Paul/Diamond)` (D-78).
- **Drafts only.** Newsletter output goes through the lint and Paul's approval (INV-6, INV-7).
- **Privacy.** Reader questions are anonymized before storage. Third-party personal details are never stored in thesis or event records.
- **Auditability.** Every alert, proposal and decision is append-only, with rule IDs and evidence links.

### 8.11 Suggested build plan for Claude Code

| Milestone | Deliverable | Done when |
|---|---|---|
| M0 Scaffold | Repo layout (below), config loader and validator (TBD detection → D-IDs), pydantic schemas, CLI skeleton | `engine config check` lists all unresolved D-IDs |
| M1 Connectors | IBKR read-only, EDGAR (company facts, filings), FRED; Parquet cache | Can pull positions, 10 years of financials and the macro series |
| M2 State | Thesis records, checkpoints, state machine, `EventLog` | Transitions and the suppression list pass their tests |
| M3 Rules | Rule YAMLs for R-/X-/C-/INV-, the evaluator and precedence | INV tests pass; every rule has a test |
| M4 Research | Pipeline stages 1–10 with typed outputs; brief renderer | One end-to-end thesis for a real name, with sources |
| M5 Monitoring | Earnings calendar, checkpoint scheduler, macro dashboard, premise register, portfolio health | Weekly brief generated automatically |
| M6 Comms | JP draft builders, templates, lint, approval queue | Lint blocks banned phrases; IA drafts include fair disclosure |
| M7 Audit | Performance (CAGR standard), hypothesis ledger, replay suite | Replay suite runs and reports agreement |
| M8 Decisions | Paul resolves the §10 Top 15 → config updated → replay re-run | Gate share falls; behavior is documented |

**Suggested repository layout**

```
paul-engine/
  CLAUDE.md
  config/philosophy.yaml
  docs/                 # this spec (00–11)
  reference/            # P1–P6 fully sourced parts + style profile
  rules/                # rulebook.yaml, exclusions.yaml, compliance.yaml, invariants.yaml
  src/engine/           # config, connectors, store, research, frameworks, rules, state, monitor, comms, audit, ui
  tests/unit/  tests/replay/
  data/                 # gitignored caches
```

**Stack (suggestion):** Python 3.11+, pydantic, SQLite (Postgres later), DuckDB/Parquet, PyYAML, pytest, Jinja2 for reports. Keep every philosophy parameter in config; nothing in code.


---

