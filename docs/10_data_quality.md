## §11 Data-quality & provenance caveats

Condensed from P6 §6.4 (DQ-01…DQ-51), plus the flags carried in P1–P5 (P2 ⚠AI-draft / ⚠series / ⚠arith; P3 and P4 ⚠; P5 ⚑). Full detail → P6 §6.4 and P4 §4.1.7.

### 11.1 Engine rules for learning from the corpus

1. **Never learn a number from a flagged passage.** A figure carrying a DQ-ID, ⚠arith, ⚠AI-draft, ⚠series or ⚑ cannot set a parameter. Recompute it from primary data, or use the corrected figure in 11.4–11.5. A flagged passage may still illustrate a principle; it may not set a threshold.
2. **Prefer later explicit statements over earlier ones**, after the date corrections in 11.2. "Later" means the date of the view, not of the file: [series] and reused text carry older views under 2026 dates. Current = Phase 7 (late Aug → Sep 2026) unless a thread says otherwise (→ P6 §6.3).
3. **Prefer explicit (E) over inferred (I).** An inference, a reconciliation or a synthesizer default never overrides an explicit statement. Every "suggested default" in §10 is I.
4. Rules or claims found *only* in likely AI-drafted or heavily third-party-derived pieces (11.3) need corroboration in first-person newsletter text before they are encoded as Paul's (P6 §6.4 rule 2).
5. Normalize performance (currency, index, total return, compounding, period) before any comparison. Store cumulative returns with dates, and compute CAGR in the engine (P4 PF3).
6. Score his calls only from contemporaneous text. Retrospective self-scoring (11.8) is checked, never trusted. Product-timing claims are not stable facts (DQ-F23).
7. Corrections the parts drew from outside knowledge are marked "verify" (e.g., DQ-F06, DQ-F07, DQ-F09, DQ-F22). Confirm them before use.

Config hooks (new keys; weights `TBD(Paul)`): `research.source_weights`, `research.dq_blocklist`, `research.date_corrections`; plus the existing `reporting.number_checks` (C-18).

### 11.2 Misdated, reused and multi-version files

| ID | Item | Correct reading / engine action |
|---|---|---|
| DQ-01 | [2024-01-24*] (file 120): its Netflix data match the Jan-2025 report | Re-date to ~Jan 2025, together with its 「年率77％」, S&P 「年率19％」 and NFLX 「年率133.3％」 |
| DQ-02 | File named "20261222" ("2026年投資戦略") | = 2025-12-22 |
| DQ-03 | [series] 2026-03-31: a curated compilation of older columns. Its 日本在住 lines; Tesla 「今は160ドルを超えている」 (2024-era); "US-only" and "the dollar is always the haven" (older text); 12Q#11 reuses the 2026-03-23 BOJ column | Residence lines are errors (never propagate). Use the series for philosophy only; never date its views to Mar-2026 |
| DQ-04 | 2026-03-24 Zoom: 「去年のシリコンバレー銀行の破綻」 (SVB failed 2023-03-10) | Stale reused text |
| DQ-05 | 2024-12-07: mentions Munger's death | A ~Dec-2023 draft; treat as a Dec-2023 view |
| DQ-06 | 2023-09-15: data "as of Aug 14" | **Parts disagree.** P6: use the Aug-14 date. P4 PF6: most likely Sep 14 (fits the Sep series). Unresolved → exclude the datapoint until checked |
| DQ-07 | 2026-08-14 "concretely tech × oil" file is dated after the series files | Barbell-version ordering → T-17, D-10 |
| DQ-08 | 2026-03-24 Zoom 279 vs 280: same date, two scripts. 279 = usual post-shock recovery; step ② "don't trade for a few days". 280 = 「今回は、その前提が問われている」; step ② "review toward 60/20/20"; adds gold and bitcoin. Both close with the 10-year test | Canonical version unknown → D-88 |
| DQ-09 | Other multi-version pieces: 116 vs 117 [2026-03-05/08]; Energy→Intelligence Pt 1 ver1 vs ver3 [2026-08-04]; risk column ver1 vs ver3 [2026-09-27]; JP vs EN FIRE essays [2026-08-23/24]; the 2022-07-03 draft vs the 07-14 final (pension age 60 vs 65; "runs a fund" vs "manages own money"); file 014 named 連載10 but headed 「連載９」; NL1 dated 2022-07-11 vs "one-year anniversary" on 2023-09-01 | Latest version canonical unless Paul says otherwise (D-88). NL1's date may be a pre-launch draft date |
| P4 RP-F7 | Start dates that conflict with RP inception (2022-08-15): the NL1 "model portfolio" (2022-07-11), the "FIRE portfolio" (from Jan 2022), CCJ "held 5 years" (first recommended 2022-12-25) | Likely different portfolios or personal holdings → D-65, D-92 |

### 11.3 Likely AI-drafted or third-party-derived pieces (lower evidence weight)

| ID | Pieces | Consequence |
|---|---|---|
| DQ-10 | 2024 columns 05-13, 05-27, 06-12, 08-12, 08-19, 08-26 (generic register; P1/P2 also list 07-10) | Generic statements = low signal. T-04's "stay 100% invested" [2024-08-12] rests on one of them |
| DQ-11 | 2024-07-10 ends with a leftover assistant line (「また、画像について何か特定の指示があればお知らせください。」) | AI-assisted draft |
| DQ-12 | 2026-02-16 Vinik anti-timing piece addresses him as 「あなたのフィデリティの先輩方が語る」 | AI-drafted; the Fidelity-lore attribution is low confidence |
| DQ-13 | 2025-12-08, 12-13; 2026-01-14, 01-28, 02-16 (files 262, 266, 269, 273 among them): drafting residue. 「最強の略奪者」 and 「冷徹なリアリズム」 may be AI-suggested framings he adopted | Weight below his explicit rules |
| DQ-14 | Third-party-heavy: APA [2025-12-04] and INPEX [2025-12-11] (outside analysts, transcripts); Fundsmith-style columns [2025-02-17/25]; the Dalio/Timmer scenario (Zoom v280, 2026-03-24) | A third-party frame is not his rule unless he restates it. Affects T-05 Side C ("avoid energy"), T-18 (gold/bitcoin), M-R05 (the 10Y 4.5% line is Timmer's) and M-R07. Sources he cites and argues with (Rogoff, Krugman/Pettis, Aschenbrenner) are not down-weighted |
| DQ-15 | [series] 2026-03-31 and 12Q 2026-03-24: onboarding/compilation material, possibly edited, with several factual slips | Philosophy summaries only (D-86) |
| DQ-16 | Koyfin "not sponsored" [2024-07-10] → affiliate discount link [2024-07-29] | Tool recommendations carry a commercial link (C-17) |
| Other parts | 2025-01-14 advisor piece, "partly garbled" (P2 ⚠AI-draft; bears on D-51 and the FIRE-portfolio claims) · F-49 "Compute = Revenue" is a third-party relay (P3, lower weight; D-58) · 2026-03-24 Zoom market figures come from Timmer and Dalio (P5 ⚑) · P1: flagged dates make up <5% of each principle's evidence | As above |

### 11.4 Performance-reporting inconsistencies (normalize before use)

Key finding (P4 §4.1.7, I): every checkable 「年率」 figure is **simple** annualization (cumulative ÷ years since 2022-08-15), not a CAGR. Never compare it with a CAGR.

| ID | As written | Problem → corrected or implied figure |
|---|---|---|
| DQ-20 | 2022-07 → 11: モデル／推奨／勧め portfolio; the 31-entry NL1 list vs the "10 recommended names"; "about 3 months" [10-20] vs "about 2.5 months" [11-03]; USD and JPY pairs; "21.3%" [11-15] | Unclear which portfolio. The USD/JPY pairs imply different FX moves for one period (≈+5.3% RP vs ≈+13.0% S&P). The 10/19 figures imply S&P −15.0%. 21.3 = 21.37 rounded |
| DQ-21 | 2023-08 → 12: SPY 「年率3.39％」 beside a cumulative 51%; OHI/BABA negative [08-18] vs "all positive, all double-digit except ATVI" [08-31] vs "all positive except BABA" [09-15]; TV +52.27% vs 27.75% [12-26] vs newsletter +59.8% / +53.19% vs 37.02% / 28.36% [12-29] | Mixed bases (since inception vs calendar year; USD vs FX-inclusive; S&P vs SPY); the name-level claims conflict (P4 PF7) |
| DQ-22 | 2024-02 → 2025-01: SPY/S&P 22.88% [02-16] vs 21.18% [02-23]; base yen [05-24] vs USD [06-21]; four CY2024 figures (50%, 54.6%, ~57%, ~60% vs 23–29%) | Different dates and currencies; all ≈2x the index. Canonical CY2024 `TBD(Paul)` (D-64) |
| 2024-02-23 | "年率" 84.47% vs SPY 23.90% | Impossible as annualized over ~1.5 yr (simple ≈56%, CAGR ≈50%); SPY "年率" exceeds its cumulative figure; perhaps trailing 1-yr (unverified) (P4) |
| FX method | 2024-02-15: FX effect taken by subtraction (6.79 pts) | Compounding gives 3.85%; both far below the ~12% USDJPY move since inception (outside-corpus check). 為替込み method unknown (P4 PF2; D-62) |
| MTD slip | 2023-05-26: relative MTD "11.27" | Should be 9.41 (the cumulative SPY figure was used) (P4 PF8) |
| DQ-23 | 「年率77％」 (~Jan 2025) | ≈+188% cumulative over 2.44 yr ≈ **54% CAGR** (P4) |
| DQ-24 | "69%/yr" since inception (to 2025-06-26); SPY 16.76%/yr | ≈+198% over 2.86 yr ≈ **46% CAGR**; SPY ≈+48% ≈ **15% CAGR** (P4) |
| DQ-24 | "75% annualized" [2025-09-26]; S&P "19%" | ≈+234% over 3.12 yr ≈ **47% CAGR**; benchmark ≈ **16%** (P4). SPY 16.76% → 19% within 3 months = a period change |
| DQ-24 | Two-year annualized 75% vs 30% [2024-12-16] | 2-yr cumulative ≈+150% vs +60% ≈ **58% vs 26% CAGR** (P4) |
| DQ-23 | NFLX 「年率133.3％」 (~Jan 2025) | ≈+325% cumulative ≈ **81% CAGR**; P6: compounding from a ~$220–240 entry gives ≈80–85%/yr, so 133.3% is cumulative ÷ years |
| DQ-23 vs P4 | S&P 「年率19％」 (~Jan 2025) | **Parts disagree:** P6 says it fits compounding; P4 treats it as simple (≈+46% ≈ 17% CAGR). Recompute from index data |
| DQ-24 | CY2025: ~30% vs S&P 19% [12-26] vs 28.09% vs SPY 17.88% [2026-01-02] | 12-26 is a pre-year-end estimate; use the final |
| DQ-25 | "Beat the S&P 500 「3.3倍以上」" [series]; NVDA "13x" | No period or basis; return multiple vs ending-value multiple unclear. The 13x runs from the ~$140 recommendation (v1#9) in one place and from the bottom over ~3 yrs (v1#11) in another (D-91) |
| DQ-26 | Big-tech basket 32.87%/yr, max loss −46% [2023-09-29] vs "paid-newsletter portfolio" 39%/yr, −58% [2024-01-24]; FIRE portfolio "losses very unlikely" [2025-01-14] | Unreconciled (different portfolio, period or averaging?). The yearly returns listed compound to ≈21.1%/yr (DQ-A05). The FIRE claim rests on one favourable 29-month window |

**Engine rule (P6):** rebuild the RP track record from dated transactions and prices; report in USD, total return, CAGR, calendar-year and since-inception, vs SPY TR; show JPY separately.

### 11.5 Arithmetic & unit errors (corrected figures)

| ID | As written [date] | Correct / check |
|---|---|---|
| DQ-A01 | ¥3M → ¥100M in 5 yrs = "97%/yr" [2025-09-22; 2025-10-03 Part6] | Needs ≈101.6–102%/yr; 97% gives ≈¥89M |
| DQ-A02 | ¥0.5M → ¥5B in 20 yrs = "78%/yr" [same] | 10,000x needs ≈58.5%/yr; 78% for 20 yrs ≈100,000x |
| DQ-A03 | Lottery ¥300 → ¥100M = "+3,333,233%" [2025-09-22] | +33,333,233% (conclusion stands) |
| DQ-A04 | 60/40 backtest: ~13% (12.94%)/yr → "+206%"; ~5.6% (5.62%)/yr → "+66.21%"; Sharpe 0.79 / 0.47 [2023-10-11; series] | Compounding gives ≈+238–239% and ≈+72–73% (the stated totals imply ≈11.8% and ≈5.2%/yr, likely arithmetic means). Return ÷ risk = 0.89 / 0.59 (the stated values imply a risk-free deduction). The 206/66 ≈ 3.1x ("3倍以上") holds |
| DQ-A05 | Big-tech yearly returns → "32.87%/yr" [2023-09-29] | ≈21.1%/yr compounded (arithmetic mean 23.4%) |
| DQ-A06 | Charity case "$1.1M (約１５億円)"; scenario 「１千７０万ドル」 [2022-09-13] | ≈¥1.5億 (10x slip); the scenario recomputes to ≈$11.8M and contradicts the ~$1.1M actually left; the savings-only ≈$1.72M checks |
| DQ-A07 | FIRE bridge: ¥2.5–3M/yr withdrawals leave ¥15–20M [2022-08-16] | Holds only near ¥2.5M/yr; at ¥3M/yr ≈¥11–14M remains |
| DQ-A08 | Fund costs "first year 20–30万円" on ¥10M [2022-12-20] | With the 1% trust fee ≈30–40万 |
| DQ-A09 | College-fund compounding; "$2–3M ≈ ¥4.6–6.2億" [2025-05-27]; mortgage figures [2025-02-24] | The FX implies ¥207–230/$ vs ~¥150–155 used in the same piece; mortgage figures approximate |
| DQ-A10 | "20 best weeks = 0.41%" [2023] | 20 of ~2,392 weeks = 0.84% (0.41% ≈ 10 weeks) |
| DQ-A11 | 百年定期 "9.75%/yr" (¥1 → ¥10,000 in 100 yrs) | ≈9.65%/yr |
| DQ-A12 | 73% real vs 147% = 「まだ半分強」 [2025-12-22] | ≈49.7%, just under half |
| DQ-A13 | China stocks "−23%" over 1, 3 and 5 yrs alike; testing cost "~8%" of revenue [2022-12-22] | Copy slip; $240bn/$2.9tn ≈8.3% fits only the upper bound ($100bn ≈3.4%) |
| DQ-A14 | "7千万–1億人以上" [2023-08-18] | ≈3,800万 (the 20% was applied to both sexes); he notes large error margins |
| DQ-A15 | ¥4.61M at ¥148 ≈ "$31,400"; "3x the savings" [2024-03-13] | ≈$31,150 (minor); "3x" is loose |
| DQ-A16 | Industrial Revolution 1–1.5%/yr for 150 yrs vs "GDP per person roughly tripled" [2026-08-04] | 1–1.5% compounds to ≈4.4–9.3x; tripling ≈0.7%/yr (the rates are presumably aggregate GDP) |
| DQ-A17 | 「1％と30％。この4桁の幅」 [2026-08-04] | Mixed units (~1% cumulative over 10 yrs vs 30% per year); "4桁" works only if 30%/yr compounds for 10 yrs (≈+1,280%) |
| DQ-A18 | AI capex "~5%" has "not yet reached" dot-com (~5%) / railway (5–7%, also "~7%") [2026-08-04] | Only the narrow 1–2% measure is clearly "not yet reached"; the railway peak is stated two ways |
| DQ-A19 | Situational Awareness ~$45B × (1−0.67) vs "~$10B AUM" [2026-08-04] | ≈$15B; gap unexplained |
| DQ-A20 | APA 969M BOE × $8–20/BOE = "$11.6–17.4B" [2025-12-04] | $7.8–19.4B (the stated range implies $12–18/BOE); the $58.1B nominal is correct |
| DQ-A21 | CCJ "~30% gap to $37–38 NAV" vs "+30% to ~$30" [2022-12-25] | The two imply different current prices (~$26 vs ~$23) |
| DQ-A22 | Tesla split-adjusted IPO "$1.27" [2023; 2026-03-24 12Q#2] | ≈$1.13 ($17 ÷ 15); "100x+" still holds |
| DQ-A23 | "$1M in 2002 ≈ $2M today" (大雑把) [2023-07-06] | CPI ≈$1.7M |
| DQ-A24 | FX/price-implied slips: TSM capex 「４兆円（４０Bドル）」; $2.3B ≈ ¥320B; BTC dollar values; yen "−38%" [2024-04-22]; "¥100 → ¥70"; 「1ドル=100円から150円」 for 2022 | Imply ¥100/$ (vs ~¥145) and ¥139/$; BTC ~$40k (stale?); yen fall ≈32–35% and ¥100 → ~¥77 (P3); 2022 began near ¥115 (¥100 → 150 spans 2021–22; the +50% / −26.7% math is correct) |
| DQ-A25 | 10x and unit slips: GOOGL "184億ドル above consensus" [2023-07-28]; Tesla 2022 revenue 「８１億ドル」; 「初任給は５５万ドル」 [2023-07-20]; 「119.５万ドルの投資が909.４万円」; 「5000億元（約70億ドル）」 [2024]; Ukrainian minerals "500億ドル" [2025-02-21]; NFLX regional net adds [2022-10-20]; OHI 「２６歳以上」 +44% [2022-10-13] | ~18億ドル; ≈810億ドル; 5.5万ドル; 119.5万円; ≈700億ドル; probably $500B; unit errors; a typo (P4: probably 85+ or 65+) |
| DQ-A26 | Meta median pay $300k vs $200k [2023-06-07 vs 07-12] | Inconsistent; do not reuse |
| DQ-A27 | AppLovin "約37倍から約15倍へ" vs forward P/E 20x at ~$312 [2026-09-25] | Different bases (2026 EPS vs NTM; the $298 trough vs now); unclarified |
| DQ-A28 | NFLX "~15x" its 2024 EPS of $15 [2023-01-26] | A reader recalls ~$340–350 (≈23x); uncertain |
| P4 flags | SK Hynix −46% called "~80%" of a typical ~50% downturn [Aug–Sep 2026]; TSMC "12.8% YoY" [2024] | 46/50 = 92% (P2 R-57 carries the "80%" unflagged); 12.8% was QoQ, YoY ≈36% |

### 11.6 Factual, name, ticker, date & wording slips

| ID | Slip → correction |
|---|---|
| DQ-F01 | "OHA" → OHI; "Jeff Rogan" → Joe Rogan; "CCF" → CCJ; "Colin Powell（中央銀行総裁）" → Jerome Powell; "OpenAIのGrok-3" → Grok-3 is xAI's; "Dimension Advisor Funds" → Dimensional Fund Advisors |
| DQ-F02 | XLRE called 「Ishares」 → a SPDR fund; BYD 「285 HK」 → BYD Co. = 1211.HK (285.HK = BYD Electronic); VGSTX is a Vanguard mutual fund, not an ETF; 1577 labelled two ways; JPXN is not an ESG fund; NVIDIA NIM = inference microservices, not networking hardware (outside knowledge) |
| DQ-F03 | 「トランプ前大統領」 for the sitting president; H20 license 「2019年4月」 → Apr-2025; SAP 「2024年第1四半期」 → Q1 2025 |
| DQ-F04 | Protest-triggering fire placed in 「四川」 → Ürümqi, Xinjiang; "three red lines" dated 2022 → 2020; PBOC easing "2023" → 2022 |
| DQ-F05 | Buffett 「95歳」 in early 2025 → 94; Shuji Nakamura 「ノーベル化学賞」 → Physics (2014); Model S "2010" → launched 2012 |
| DQ-F06 | 「FRBが10ヶ月で金利を5%以上引き上げた」 → the 2022 hikes ≈4.25 pts; 5%+ took ~14 months; SVB 「米国18位」 → commonly ~16th (verify) |
| DQ-F07 | Cameco 「2024年後半に130ドル」 → CCJ traded ~$50–60 in late 2024; perhaps late 2025 and/or C$ (verify; D-92) |
| DQ-F08 | KWEB 「2026年以来の低いレベル」 → 2016; 「９８年ごろ…８０−９０円」 → USD/JPY was ~115–147 in 1998; 80–90 fits ~1995 |
| DQ-F09 | S&P max drawdown since 1994 "~50%" → ≈57% (2007–09). Doubtful, verify: Xbox 「250万人」; MPLX's only cut "2021 Q4 (COVID)"; NVDA segment mix 60/30/8/2; corporate cash 「２２００億ドル」; dividend tax "lower than the 20% capital-gains rate"; WPC "never cut" [2023-11-16] (outside knowledge: a dividend reset was announced with the office spin-off in Sep-2023) |
| DQ-F10 | CVX "Hess went well" before the deal closed; NVDA "total revenue +427%" → data-center growth; TSMC "12.8% YoY" → QoQ; ASML "7%/93%" garbled; BABA RMB/USD pairs mismatched; HSY 「PER(1株利益)」 mislabel |
| DQ-F11 | MSFT cloud +28% vs +19% (Azure vs segment); US Q3 GDP 4.6% vs 4.9% within days; META +164% vs +168% (net income vs EPS; not a real conflict); META guide called "above" a consensus equal to its midpoint; Contrafund GOOGL and META both 3.34% (possible copy slip) |
| DQ-F12 | NFLX "~220M" and "300M+" in one letter; WTI "~$60" → "~$68" a week later (Brent vs WTI, or stale); "July inflation 2.9%" (possibly the August print) |
| DQ-F13 | Tesla: "−60% in 2019 on Model 3 failure" vs "2018–19 Model 3 mass-production success" (internally contradictory); the "13x" bases (DQ-25) |
| DQ-F14 | Japan's labour force "~half by 2050" overstated; "active funds beat the index by ~3%" questionable; wash-sale rule simplified (the window is 30 days before or after); year-end tax selling called the "January effect"; US renewable share 3.5% (likely wind/solar only) |
| DQ-F15 | Bitcoin paired with gold as a dollar-confidence hedge while the cited Timmer data show BTC +64% correlated with the dollar (gold −27%) → internally inconsistent (D-39) |
| DQ-F16 | 「逆張り」 used for "sell when prices fall, buy when they rise" → 順張り; 「カバードプット」 for selling puts without the stock → cash-secured put; a yen move attributed to 「アメリカの利下げ観測」 → receding cut expectations; 「共和党」 written for both sides → the second = 民主党 |
| DQ-F17 | 「私は一本のものにするのはススメしたいです」 → likely "don't recommend"; 「個別銘柄は国単位で考えるように」 contradicts its heading 「国で考えるより、会社で考えます」; 「需要」 → 重要; 「８０円台の円安」 → 円高; 「為替は円安に転じます」 [2023-12-14] → possibly 円高 (uncertain) |
| DQ-F18 | "This 14-name list" lists 13; 13 → 12 names with no removal explained; "two lessons" followed by three; energy 「最近１年ぐらいは最悪」 [2022-11-03] contradicts "best sector in 2022" [2022-08-02] (maybe "~10 years"); NFLX 「年間８−９０万人」 garbled; 「役８０％」 → 約80% |
| DQ-F19 | XLRE driver list 「２０２０年初期から現在」 → 2022 intended; FX regimes "2016–2022 flat" and "2021–2023 weak yen" overlap |
| DQ-F20 | Real estate as a store of value 「借入を抑えて」 (column) vs 「適度なレバレッジで」 (TV); shutdown "permanent damage" vs "not permanent" → wording drift between formats (T-30, m-11) |
| DQ-F21 | 「三井商事」 → ambiguous (三井物産 or 三菱商事?); "LVのバッグ理論" illustrated with a Hermès Birkin → naming mismatch |
| DQ-F22 | Xi became leader "right after" his late-2013 return to Tokyo → Xi took office Nov-2012 / Mar-2013 (outside knowledge); a minor memoir slip |
| DQ-F23 | GB300 expected "2026 or later"; H20 ban (~$8B/quarter lost) → re-approval (Jul) → net positive (Aug 2025) → facts changed within months; never encode product timing as stable |

### 11.7 Biography & holdings conflicts (do not encode precise memoir details)

| ID | Conflict | Best reading |
|---|---|---|
| DQ-40 | MBA: left ExxonMobil "in 2002" [2023-01-10] vs "around 2000" [2023-07] vs "early 1990s" [2024-09-20]; 9/11 came "after my MBA summer internship" | Born ~1975, so the 1990s is impossible → ~2000–02 (D-85) |
| DQ-41 | Dot-com: sold most in 2001 to pay for business school ("luck") [2022-12-30] vs big losses buying on 熱狂 [series]; "froze and didn't buy" [2023-01-10] vs "my biggest gains came from 9/11, Lehman…" [2024-12-07] | Not reconcilable; the lesson (story-based method; buy crashes) is consistent, the details are not |
| DQ-42 | 日本在住 [series] vs Seattle; 「40年の日本経験」 [2026-03-16] vs first Japan visit ~1992 (≈34 yrs) | Seattle; "40 years" is loose |
| DQ-43 | A relative's AI-adoption anecdote described inconsistently across files | Anecdote only; do not encode |
| DQ-44 | "No Japanese brokerage account" [2025-06-02; 2025-10-03] vs a Monex account used to check XLRE [2023-11-30] and "trades Japanese stocks through Monex when needed" [2025-05-19] | Unresolved; affects the access gate (D-53) |
| DQ-45 | ORCL held personally through −40%+ [2025-12-18/19] vs "does not own Oracle" [2026-09-11/18] | Sold (unreported) or a personal-vs-RP distinction; ask (D-68) |

### 11.8 Retrospective self-scoring vs the contemporaneous record

| ID | Retrospective claim | Contemporaneous record |
|---|---|---|
| DQ-50a | Dec-2023 Fed pivot "predicted for months" [2023-12-14] | Fed-peak call at 5.25% [2023-05-05], then more hikes expected [2023-06-30]; "higher for longer is the main scenario" [2023-08-18] |
| DQ-50b | China's reopening came "as predicted" [2022-12-12] | He had forecast a gradual reopening in Q2 or H2 2023 [2022-11-29]; it came in Dec-2022 |
| DQ-50c | SVB day: "went through my watchlist and bought quality banks down 10–20%" [2026-03-24; 03-29] | A bank-ETF trade with a time stop [2023-03-16]; regional banks a low-confidence idea [2023-03-22] → reduce [2023-04-14] → don't hold [2023-05-05]. Not false, but the reduction is omitted |
| DQ-50d | 「領収書付き」 is "a term I have long used" [2026-08-24] | 2024: capex is good and FCF doesn't matter for growth stocks; the only receipts-style argument was NVDA's confirmed orders vs Cisco [2024-02-29] → effectively a 2026 framework (m-22) |
| DQ-50e | NVDA 「見事にサポートレベルから反転」 [2024-09-24] | One self-graded chart call, not a tested rule |
| DQ-50f | FIRE portfolio "losses very unlikely" [2025-01-14] | Rests on one favourable 29-month window |

**DQ-51 documented misses** (weight his macro and geopolitical forecasts with these, not his stock theses): the Mar-2023 hike judged unnecessary [2023-03-22]; the unified-government call [2024-11-04 → 11-19]; the midterm call reversed [2025-04-10 → 10-03]; WTI $92–100+ [2024-03-29] while energy was among 2024's worst assets; oil "near the bottom" [2025-05-08] yet still in the $60s in Sep-2025; "¥150 may be peak weakness" [2024-03-08] → broke 153; big yen strength "unlikely" [2024-03 → 05] → the Aug-2024 spike; the Iran short-war view [2026-03-19] reversed [2026-07-24]; curve steepening wrong [2026-09-18]; GB300 timing [2025-02-27]. P5 adds: the Fed peak level, "2% inflation by 1H2024", a stronger yen in 2024, the 2026 rate-cut tailwind.
**Documented hits he cites:** NVDA (recommended Sep-2022), NFLX (Aug-2022), "AI won't kill Google search" [2025-12-26], the Trump 2024 win [2024-01-19 → 10-24], selling China before COVID [2025-11-27].
**Implication (P6, I):** his edge shows in company/theme theses and crisis buying, not in macro, FX or geopolitical point forecasts → macro stays an overlay (D-30, D-35).

### 11.9 Numbers to verify before encoding (P3 Q19, P5 Q17)

- The 2023-05-05 hike-cycle comparison with 1984/2015 (P5; not otherwise in the register).
- Corporate cash 「２２００億ドル」 [2023-09-22] (DQ-F09).
- "Fed +5% in 10 months" in 2022 [series] (DQ-F06).
- The mortgage math [2025-02-24] (DQ-A09).
- Ukrainian minerals "500億ドル" [2025-02-21] (DQ-A25).
- Japan's labour force "~half by 2050" [2024-11-18] (DQ-F14).
- 「円安に転じます」 [2023-12-14], probably 円高 (DQ-F17).
- "July inflation 2.9%" [2025-09-18] (DQ-F12).
- Yen "−38%" [2024-04-22] → ~32–35% (P3; DQ-A24); ¥100 → ¥70 → ~¥77 (P3).
- APA PV-10 vs nominal reserves (DQ-A20); NFLX regional net adds (DQ-A25); NVDA "+427% total revenue", likely data-center growth (DQ-F10); OHI 「26歳以上 +44%」 typo (DQ-A25).

### 11.10 Cross-part inconsistencies found while condensing

- **DQ-06 data date:** P6 says use Aug-14; P4 PF6 says it is most likely Sep-14. Unresolved → exclude the datapoint.
- **S&P 「年率19％」 (~Jan 2025):** P6 DQ-23 says it fits compounding; P4 §4.1.7 treats it as simple (≈17% CAGR). Recompute from index data.
- **Name-count defaults:** P6 T-07 proposes 15–25 names (floor 10); P2 R-70 proposes [10, 20] (D-08).
- **Crisis-trigger defaults:** P6 T-02 proposes a −10–20% watchlist rule; P2 INV-3/R-33 forbid %-drop triggers. They are consistent only if the level is an ALERT (D-22, D-27).
- **Current barbell reading:** P2 R-77 = tech × oil (2026-08-14 / 09-11); P6 T-17 = AI chain incl. uranium + oil/gas majors (+ gold) + RE under review; P3 Q5 records a return to "tech × oil" on 2026-09-11 (D-10).
- **ID collisions:** P6 reuses F-01…F-12 (formative experiences) and C-01…C-14 (career timeline), which clash with P3's F-xx frameworks and P2's C-xx compliance rules. Always cite P6's with a "P6" prefix. (P6's M-01…M-08 media IDs and P5's M-Rxx macro rules do not clash.)
- **OHI status:** P2 R-16 says OHI is still listed in the profile's Aug-2026 holdings; P4 §4.1.8 puts it in Tier 2 (last named 2026-03-12; only "RE ETFs" named in Aug). Different sources; confirm via D-71.
- **Unflagged slip:** P2 R-57 carries SK Hynix "~80% done" as written; P4 flags 46/50 = 92% (11.5). Do not learn it.


---

