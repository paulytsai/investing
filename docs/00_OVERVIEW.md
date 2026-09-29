# Paul Tsai — Investment Philosophy & Engine Spec

**Version 1.0 · 2026-09-29 · Built for porting into Claude Code**

This specification turns Paul Tsai's investment philosophy into a form an engine can implement. The source is roughly 460 unique documents of his own writing, July 2022 → September 2026:
- the weekly Diamond ザイ newsletter;
- 連載 columns;
- Stock Voice TV notes;
- webinar and Zoom scripts;
- draft book chapters;
- his writing-style and compliance profile.

Every principle, rule and framework in it traces to dated passages in that corpus. Where Paul never gave a number, the spec says `TBD(Paul)` instead of inventing one.


**Contents**
§0 How to use this spec (conventions · the spine · invariants · decide-first list) — §1 Philosophy on one page — §2 Core principles register — §3 Decision system — §4 Research process & frameworks — §5 Portfolio — §6 Macro overlay — §7 Communication & compliance guardrails — §8 Engine blueprint — §9 Configuration (+ full config/philosophy.yaml) — §10 Decisions needed from Paul — §11 Data-quality & provenance caveats — §12 Glossary — §13 File map (in §0 block)


---

## §0 How to use this spec

### 0.1 Reading order
1. **This overview.** Conventions, the spine, the invariants, the first decisions to make, and the file map.
2. **§1–§2 Philosophy and principles** (`01_philosophy.md`). Why and how he invests; 42 principles, 23 temperament beliefs, 29 influences.
3. **§3 Decision system** (`02_decision_system.md`). The thesis-state machine, 130 rules (R-01…R-130), 40 exclusions (X-01…X-40), the sizing policy, the crisis playbook and the invariants.
4. **§7 Compliance** (`06_compliance.md`). Read this before building anything that writes text for the newsletter.
5. **§8 Engine blueprint** (`07_engine_blueprint.md`) and **§9 Configuration** (`08_configuration.md` + `config/philosophy.yaml`).
6. **Deep sections as needed:**
   - §4 Research & frameworks (122 frameworks, a 10-stage pipeline, metrics);
   - §5 Portfolio (history, performance, cases);
   - §6 Macro overlay;
   - §10 Decisions needed from Paul (93 decisions, Top 15);
   - §11 Data quality;
   - §12 Glossary.
7. **Provenance:** `reference/P1…P6`, the fully sourced long-form parts, with date lists and verbatim Japanese quotes for every item.

### 0.2 ID conventions

| Prefix | Meaning | Defined in |
|---|---|---|
| P-01…P-42 | Core principles | §2 / P1 |
| P1 T-01…T-23 | Temperament and behavioral beliefs (always written with the "P1" prefix) | §2.2 / P1 |
| INF-01…INF-29 | Influences (Lynch, Buffett, Bolton, Danoff, Tillinghast…) | §2.3 / P1 |
| R-01…R-130 | Decision rules | §3.2 / P2 |
| X-01…X-40 | Exclusions and red flags | §3.3 / P2 |
| INV-1…INV-7 | Engine invariants | §3.6 / P2 |
| C-01…C-20 · RG-01…RG-18 | Compliance guardrails · reader-guidance patterns | §7 / P2 |
| F-01…F-122 | Analytical frameworks | §4 / P3 |
| T-01…T-33 (bare "T-") | Tensions between stated rules and practice | §10 / P6 |
| D-01…D-93 | Decisions needed from Paul | §10 |
| M-P, M-R, I-, PR-, R1–R6, C1–C8, D1–D14 | Local IDs in the macro section: macro principles, macro rules, indicators, premises, regimes, macro channels, stance-vs-practice divergences. **Local to §6/P5.** Do not confuse C1–C8 with C-01…C-20, D1–D14 with D-01…D-93, or R1–R6 with R-01…R-130. | §6 / P5 |

### 0.3 Strength, encodings and value conventions
- **Strength**
  - **Core★**: explicitly called a rule or core design by Paul.
  - **Core**: explicit and recurring on ≥3 distinct dates, or explicitly framed as a rule.
  - **Stated**: explicit on 1–2 dates.
  - **Observed**: inferred from his actions.
  - Provenance is shown as first→last year and the number of distinct dates.
- **Encodings** (how a rule is implemented)
  - **HARD**: an inviolable constraint.
  - **SOFT**: a scoring or ranking input.
  - **ALERT**: surfaced for review; nothing is automated.
  - **GATE(Paul)**: needs Paul's explicit approval.
  - **GATE(reader)**: handed to the reader-as-PM as a framework, never as an instruction.
- **`TBD(Paul)`**: never stated by Paul. The engine must ALERT → GATE(Paul) and never guess (INV-5). "Suggested default" values in §10 are proposals, not rules. They take effect only after Paul approves them and they are written into config.
- **Evidence flags**
  - ⚠series: from the curated 2026-03-31 column compilation.
  - ⚠AI-draft: a lower-weight source.
  - ⚠arith: an arithmetic slip in the source (see §11).
  - Later explicit statements beat earlier ones; explicit beats inferred.
- **Privacy**: no third-party personal details; no personal wealth figures.

### 0.4 The spine in twelve lines
1. **Method:** buy companies with a good investment story when everyone is pessimistic, and hold them for the long term (§1).
2. **Survival first (退場しない):** bet only at a size that keeps you in the game even when wrong. No leverage-dependent bets and no Martingale (P-09, R-67, INV-4).
3. **Asymmetry by sizing:** start small, never sell the winners, and let winners become the big positions; "small when wrong, uncapped when right" (P-08).
4. **Thesis over price:** `thesis_status` is the master variable. Add only when the price falls and the thesis is unchanged; sell only when the thesis breaks. Volatility is noise (P-02, §3.1).
5. **Crises are the opportunity:** decide in calm times, classify the shock, deploy in stages where the story is intact, and never panic-sell (P-01, §3.5).
6. **Allocation first:** asset class → sector → stock. Currency and country are allocation choices, and the US is the anchor (P-11, P-15).
7. **Barbell:** an AI/tech growth core insured by energy and real assets. The third leg has been redefined several times (T-17, D-10).
8. **Moats that are mechanisms:** own the indispensable #1 (主役企業) and toll booths (関所); treat commodity businesses as cyclical (R-03, R-04, F-01, F-04).
9. **AI-era map:** the intelligence supply chain (知能のサプライチェーン), receipts-backed capex (領収書付きCapEx) and utilization (点灯率). Compute commoditizes; intelligence and toll booths take the margin (§4.4).
10. **Macro:** no edge in forecasting it, but it sets allocation, sleeves and cash parking, and it creates buying opportunities. It is never the reason to sell a thesis-intact name (§6).
11. **Low turnover, premise inspection:** don't churn. Inspect premises (前提の点検) and publish your misses (P-04, P-28, P-21).
12. **Readers are their own PMs:** the newsletter supplies frameworks, status and 点検材料, never orders. Recommended-portfolio (RP) changes are Paul-only (INV-1, INV-6, §7).

### 0.5 Engine invariants (binding everywhere)

| ID | Invariant |
|---|---|
| INV-1 | **Paul-only RP changes.** Inclusion, exclusion, weight change and any affirmative add-call on an RP name are GATE(Paul) (C-06). |
| INV-2 | **Thesis record everywhere.** Every holding and every idea carries a written thesis with break conditions and 点検材料 (R-09). `thesis_status` drives add/hold/sell. |
| INV-3 | **No price-only triggers.** No %-drop buys, no stop-losses, no %-gain auto-trims (R-33, R-55). Trims happen only through GATE(Paul). |
| INV-4 | **Survival first.** Every sizing proposal passes the 退場しない check (R-67) before any optimization. |
| INV-5 | **No invented thresholds.** A `TBD(Paul)` parameter defaults to ALERT → GATE, never to a guessed number. |
| INV-6 | **Reader-PM.** Reader-facing outputs never contain sizing instructions or imperative buy/sell calls. They contain the framework, the status, the weaknesses and 点検材料 (C-02–C-07). |
| INV-7 | **Output lint.** The forbidden-phrase lint (C-05) runs on every newsletter-bound string. |

The engine **never places orders** and **never publishes**. It researches, monitors, proposes and drafts (§8).

### 0.6 Decide these first (from §10.15)

| Rank | D-ID | Decision | Why it comes first |
|---|---|---|---|
| 1 | D-27 | Rule hardness | Global switch: whether any numeric line (crisis %, 10Y, oil persistence, bands) acts or only alerts. |
| 2 | D-11 | Engine user profile & index core | Sets which portfolio the engine optimizes (RP vs personal), plus name counts, cash, sleeves, FX outputs and wording. |
| 3 | D-04 | Survival budget | The R-67 check runs before any optimizer. Without numbers, sizing has no binding constraint. |
| 4 | D-01 | Max position / the "20%" | Binds every add and the largest holding; defines forced-rebalance logic. |
| 5 | D-10 | Canonical barbell | Defines the sleeves and bands used by rebalancing, hedging and allocation. |
| 6 | D-17 | Thesis-break exits & kill criteria | The primary sell path; counters the documented slowness to exit. |
| 7 | D-02 | Starter size & add rules | Every entry and add; the tranche scheduler. |
| 8 | D-16 | Rebalancing method | Sleeve vs name, calendar vs band. |
| 9 | D-15 | Profit-taking / valuation-only sells | The only discretionary trim path. |
| 10 | D-22 (+ D-45) | Crisis trigger & dry powder | His best-documented edge; defines crisis mode and cash deployment. |
| 11 | D-60 | AI de-risk & funding-stress triggers | The only exit path for the largest theme. |
| 12 | D-59 (+ D-05) | Uranium classification & AI-theme cap | Sets the concentration metric and whether the energy leg hedges at all. |
| 13 | D-30 (+ D-31) | Macro scope & premise register | Whether regime variables may tilt sleeves, and whether they can ever sell a name. |
| 14 | D-53 (+ D-52) | Primary universe & US core | Eligibility of every candidate; the regional bands. |
| 15 | D-28 | Technicals scope | The entry-pacing overlay and output lint (a stated-vs-practiced gap on ≈33 dates). |

---

## §13 File map

| File | Section | Contents |
|---|---|---|
| `CLAUDE.md` | — | Standing instructions for Claude Code in the engine repo |
| `docs/00_OVERVIEW.md` | §0, §13 | This file |
| `docs/01_philosophy.md` | §1–§2 | One-page philosophy; principles register P-01…P-42; temperament; influences |
| `docs/02_decision_system.md` | §3 | Thesis-state machine; rulebook R-01…R-130; exclusions X-01…X-40; sizing and construction; crisis playbook; invariants |
| `docs/03_research_frameworks.md` | §4 | 10-stage research pipeline and artifacts; framework index F-01…F-122; metrics & thresholds; AI-era toolkit |
| `docs/04_portfolio.md` | §5 | Current holdings map; barbell design; history; performance record; key cases; sector stances |
| `docs/05_macro.md` | §6 | Macro stance vs practice; indicator dashboard; macro rules; standing views and premises; track-record lessons |
| `docs/06_compliance.md` | §7 | RP vs 投資アイデア; approved phrasings; forbidden phrases; fair disclosure; reader-guidance patterns |
| `docs/07_engine_blueprint.md` | §8 | Architecture, data sources, data model, rule evaluation, workflows, replay tests, build plan |
| `docs/08_configuration.md` | §9 | How `config/philosophy.yaml` is organized and maintained |
| `docs/09_decisions_needed.md` | §10 | D-01…D-93 with evidence, suggested defaults and config keys; Top 15; crosswalk |
| `docs/10_data_quality.md` | §11 | Rules for learning from the corpus; misdated files; AI-drafted pieces; arithmetic errors with corrections |
| `docs/11_glossary.md` | §12 | 247 terms (JP ↔ EN) with IDs |
| `config/philosophy.yaml` | §9 | 525 parameters (158 `TBD(Paul)`), with provenance comments |
| `reference/P1_philosophy.md … P6_tensions_context.md` | — | Full sourced parts: date lists, recurrence counts, verbatim quotes, open questions |
| `reference/PAUL_STYLE_PROFILE.md` | — | Paul's Japanese writing-style and compliance profile for newsletter drafts |


---

