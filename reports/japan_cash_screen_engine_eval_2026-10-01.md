# Japan cash / working-capital screen through the Paul Tsai investment engine (as of 2026-09-29)

The 331 non-financial companies whose cash or working capital was at least their market value, from the screen saved at `reports/japan_cash_wc_above_mktcap_2026-09-30.csv` (local only; the repo ignores CSVs in reports), run through `engine evaluate --region jp --as-of 2026-09-29 --universe full` on branch `claude/investment-philosophy-summary-218q6y`. Each name is ranked by Idea Strength within a universe of 1,257 Japanese names: the engine's own universe of companies worth ¥100B or more, plus these 331.

Screen tiers: **A** = current assets minus all liabilities (NCAV) at least market value; **B** = net cash at least market value; **C** = gross cash at least market value; **D** = working capital at least market value.

## Engine verdicts

- Buy in stages: 2  ·  watch: 2  ·  eligible: 17  ·  chosen by the sourcing top-20: 1
- Not eligible: G2 avoid 275; X-01/X-02 28; X-22/R-15 + G2 avoid 11

| Code | Company | Engine status | Idea Strength | Rank / 1,257 | Tier | Mkt cap ¥B | P/B | Div. yield | Blocked by |
|---|---|---|---:|---:|---|---:|---:|---:|---|
| 3933 | CHIeru Co.,Ltd. | buy-in-stages | 84.0 | 2 | C | 4.24 | 1.18 | 3.3% | chosen |
| 6366 | Chiyoda Corporation | buy-in-stages | 75.9 | 20 | B | 171.81 | 2.59 | 0.0% | eligible |
| 8996 | HouseFreedom Co.,Ltd. | watch | 64.4 | 125 | C | 4.46 | 1.13 | 5.1% | eligible |
| 4337 | PIA CORPORATION | watch | 58.6 | 252 | B | 39.28 | 3.65 | 1.4% | eligible |

## Data gaps that affect the Japan results

1. **Gate G2 (value trap) blocks every Japanese stock trading below book.** G2 passes a stock below 1× book only if there is insider buying, or shareholder yield (dividends plus buybacks) of at least 2%. For Japan, though, the engine has dividends per share but not dividends paid or buybacks, and there is no Japanese equivalent of US insider-trading filings. So shareholder yield always comes out as 0%, and G2 blocked 275 of the 331. Using the J-Quants dividend per share against price, **201 of those 275 actually yield 2% or more**. With complete data they would pass G2.
2. **Every Japanese name is filed under the sector 'Other'.** The engine's theme sectors don't map the Tokyo Stock Exchange's 17 sector groups, so there is no sector call and the sector-first top-N treats Japan as one bucket.
3. **The macro panel is US-only** (Treasury yields, CPI, oil), and **narratives are off** because this session has no Anthropic API key.
4. **Local changes needed to run** (not committed): the engine asked J-Quants for data from `2016-09-30`, but the subscription now starts `2016-10-01`, so `JQ_START` in `src/engine/pit/pull_jp.py` was moved to that date. `engine build pit --region jp` was killed for lack of memory on 16 GB of RAM with no swap, so it was rerun with a 16 GB swap file.

## Highest Idea Strength among the 331

Sorted by Idea Strength. 'Blocked by' is the engine's own result; 'Div. yield' shows whether a G2 block is a data artifact (2% or more means it would pass with complete data).

| # | Code | Company | Engine status | Idea Strength | Rank / 1,257 | Tier | Mkt cap ¥B | P/B | Div. yield | Blocked by |
|---:|---|---|---|---:|---:|---|---:|---:|---:|---|
| 1 | 3933 | CHIeru Co.,Ltd. | buy-in-stages | 84.0 | 2 | C | 4.24 | 1.18 | 3.3% | chosen |
| 2 | 8944 | LAND BUSINESS  CO.,LTD. | pass | 82.7 | 3 | C | 5.79 | 0.33 | 2.4% | G2 avoid |
| 3 | 7162 | ASTMAX Co.,Ltd. | pass | 78.5 | 13 | C | 3.86 | 0.55 | 2.7% | G2 avoid |
| 4 | 7937 | TSUTSUMI JEWELRY CO.,LTD. | pass | 76.1 | 19 | A | 38.93 | 0.56 | 4.6% | G2 avoid |
| 5 | 6366 | Chiyoda Corporation | buy-in-stages | 75.9 | 20 | B | 171.81 | 2.59 | 0.0% | eligible |
| 6 | 7034 | Prored Partners CO.,LTD. | pass | 74.2 | 24 | A | 3.5 | 0.30 | 0.0% | G2 avoid |
| 7 | 9867 | Solekia Limited | pass | 73.0 | 29 | A | 9.09 | 0.70 | 0.7% | G2 avoid |
| 8 | 1718 | MIKIKOGYO CO.,LTD. | pass | 71.3 | 41 | D | 8.11 | 0.41 | 5.0% | G2 avoid |
| 9 | 3710 | Jorudan Co.,Ltd. | pass | 71.0 | 43 | A | 3.38 | 0.68 | 0.9% | G2 avoid |
| 10 | 6092 | EnBio Holdings,Inc | pass | 70.8 | 44 | D | 6.34 | 0.66 | 1.2% | G2 avoid |
| 11 | 5987 | ONEX Corporation | pass | 68.4 | 63 | C | 2.74 | 0.48 | 1.2% | G2 avoid |
| 12 | 9816 | Striders Corporation | pass | 65.9 | 96 | C | 2.5 | 0.90 | 1.9% | G2 avoid |
| 13 | 9193 | Tokyo Kisen Co.,Ltd. | pass | 65.5 | 101 | C | 8.83 | 0.30 | 5.7% | G2 avoid |
| 14 | 7122 | THE KINKI SHARYO CO.,LTD. | pass | 65.4 | 104 | D | 16.34 | 0.46 | 2.1% | G2 avoid |
| 15 | 7294 | YOROZU CORPORATION | pass | 64.6 | 120 | C | 21.52 | 0.33 | 3.8% | G2 avoid |
| 16 | 6493 | NITTAN Corporation | excluded | 64.5 | 123 | D | 13.68 | 0.31 | 4.2% | X-22/R-15, G2 avoid |
| 17 | 8996 | HouseFreedom Co.,Ltd. | watch | 64.4 | 125 | C | 4.46 | 1.13 | 5.1% | eligible |
| 18 | 7874 | LEC,INC. | pass | 63.8 | 141 | D | 36.18 | 0.93 | 2.8% | G2 avoid |
| 19 | 3439 | Mitsuchi Corporation | pass | 63.3 | 147 | A | 3.59 | 0.35 | 3.0% | G2 avoid |
| 20 | 7212 | F-TECH INC. | pass | 63.1 | 154 | C | 13.59 | 0.18 | 3.3% | G2 avoid |
| 21 | 6428 | OIZUMI Corporation | pass | 63.0 | 155 | C | 7.38 | 0.39 | 3.7% | G2 avoid |
| 22 | 7677 | Yashima & Co.,Ltd. | pass | 63.0 | 156 | B | 7.77 | 0.74 | 0.9% | G2 avoid |
| 23 | 6335 | TOKYO KIKAI SEISAKUSHO,LTD. | pass | 62.8 | 160 | A | 5.07 | 0.50 | 0.0% | G2 avoid |
| 24 | 7279 | HI-LEX CORPORATION | pass | 62.8 | 163 | A | 92.91 | 0.39 | 1.9% | G2 avoid |
| 25 | 7615 | KYOTO KIMONO YUZEN HOLDINGS Co.,Ltd. | pass | 62.7 | 164 | B | 2.03 | 0.66 | 1.6% | G2 avoid |
| 26 | 9063 | Okayamaken Freight Transportation CO.,LTD. | pass | 62.6 | 165 | C | 9.07 | 0.33 | 1.9% | G2 avoid |
| 27 | 2750 | S.ISHIMITSU&CO.,LTD. | pass | 62.3 | 172 | D | 10.66 | 0.67 | 3.4% | G2 avoid |
| 28 | 8887 | SYLA Holdings Co.,Ltd. | pass | 61.5 | 180 | D | 15.21 | 0.81 | 3.6% | G2 avoid |
| 29 | 6418 | JAPAN CASH MACHINE CO.,LTD. | pass | 61.0 | 193 | D | 36.73 | 0.99 | 3.2% | G2 avoid |
| 30 | 9820 | MT GENEX CORPORATION | pass | 61.0 | 194 | D | 4.26 | 0.94 | 1.0% | G2 avoid |
| 31 | 6771 | IKEGAMI TSUSHINKI CO.,LTD. | pass | 60.5 | 203 | A | 4.79 | 0.36 | 2.3% | G2 avoid |
| 32 | 5282 | GEOSTR Corporation | pass | 60.0 | 214 | A | 12.55 | 0.51 | 3.3% | G2 avoid |
| 33 | 9248 | People, Dreams & Technologies Group Co.,Ltd. | pass | 59.9 | 216 | D | 15.1 | 0.68 | 3.9% | G2 avoid |
| 34 | 6663 | TAIYO TECHNOLEX CO.,LTD. | pass | 59.7 | 220 | C | 1.87 | 0.66 | 1.9% | G2 avoid |
| 35 | 9854 | AIGAN CO.,LTD. | pass | 59.5 | 225 | A | 5.58 | 0.45 | 0.0% | G2 avoid |
| 36 | 9647 | KYOWA ENGINEERING CONSULTANTS CO.,LTD. | pass | 59.4 | 227 | B | 3.97 | 0.78 | 0.4% | G2 avoid |
| 37 | 2681 | GEO HOLDINGS CORPORATION | pass | 59.2 | 233 | D | 91.66 | 0.91 | 1.5% | G2 avoid |
| 38 | 3477 | FORLIFE Co.,Ltd. | pass | 59.2 | 235 | A | 3.54 | 0.80 | 3.4% | G2 avoid |
| 39 | 5707 | Toho Zinc Co.,Ltd. | pass | 59.2 | 234 | D | 17.05 | 0.93 | 0.0% | G2 avoid |
| 40 | 6395 | TADANO LTD. | pass | 59.1 | 239 | D | 172.88 | 0.79 | 3.3% | G2 avoid |
| 41 | 1994 | TAKAHASHI CURTAIN WALL CORPORATION | pass | 59.0 | 243 | A | 5.79 | 0.52 | 3.3% | G2 avoid |
| 42 | 4839 | WOWOW INC. | pass | 59.0 | 241 | A | 28.15 | 0.40 | 3.1% | G2 avoid |
| 43 | 1887 | JDC CORPORATION | pass | 58.7 | 248 | D | 47.48 | 0.67 | 4.7% | G2 avoid |
| 44 | 4337 | PIA CORPORATION | watch | 58.6 | 252 | B | 39.28 | 3.65 | 1.4% | eligible |
| 45 | 5341 | ASAHI EITO HOLDINGS CO.,LTD. | pass | 58.6 | 250 | D | 1.27 | 0.79 | 0.0% | G2 avoid |
| 46 | 7872 | ESTELLE HOLDINGS CO.,LTD. | pass | 58.4 | 257 | D | 7.05 | 0.59 | 4.4% | G2 avoid |
| 47 | 4102 | Maruo Calcium Co.,Ltd. | pass | 58.3 | 258 | D | 3.38 | 0.32 | 4.2% | G2 avoid |
| 48 | 2385 | Soiken Holdings Inc. | excluded | 58.1 | 263 | A | 5.65 | 0.92 | – | X-01/X-02 |
| 49 | 2586 | FRUTA FRUTA INC. | excluded | 58.1 | 264 | A | 6.97 | 0.95 | – | X-01/X-02 |
| 50 | 3261 | GRANDES,Inc. | excluded | 58.1 | 265 | A | 1.83 | 0.69 | – | X-01/X-02 |
| 51 | 3623 | Billing System Corporation | excluded | 58.1 | 266 | B | 8.39 | 2.51 | – | X-01/X-02 |
| 52 | 3674 | Aucfan Co.,Ltd. | excluded | 58.1 | 267 | C | 3.61 | 0.88 | – | X-01/X-02 |
| 53 | 4316 | BeMap,Inc. | excluded | 58.1 | 268 | A | 0.14 | 0.36 | – | X-01/X-02 |
| 54 | 6030 | Adventure,Inc. | excluded | 58.1 | 269 | C | 11.97 | 1.27 | – | X-01/X-02 |
| 55 | 6049 | ItoKuro Inc. | excluded | 58.1 | 270 | A | 5.69 | 0.59 | – | X-01/X-02 |
| 56 | 6094 | FreakOut Holdings,inc. | excluded | 58.1 | 271 | C | 9.39 | 0.69 | – | X-01/X-02 |
| 57 | 6147 | YAMAZAKI CO.,LTD. | excluded | 58.1 | 272 | C | 0.76 | 0.75 | – | X-01/X-02 |
| 58 | 7851 | KAWASE COMPUTER SUPPLIES CO.,LTD. | excluded | 58.1 | 273 | C | 0.89 | 0.35 | – | X-01/X-02 |
| 59 | 7985 | NEPON Inc. | excluded | 58.1 | 274 | A | 0.69 | 0.31 | – | X-01/X-02 |
| 60 | 8938 | GLOME Holdings,Inc. | excluded | 58.1 | 275 | A | 3.27 | 0.42 | – | X-01/X-02 |
| 61 | 6577 | Bestone.Com Co.,Ltd | excluded | 58.1 | 276 | C | 2.09 | 1.55 | – | X-01/X-02 |
| 62 | 7041 | CRG HOLDINGS CO.,LTD. | excluded | 58.1 | 277 | C | 1.86 | 0.62 | – | X-01/X-02 |
| 63 | 4429 | Ricksoft Co.,Ltd. | excluded | 58.1 | 278 | B | 3.36 | 0.98 | – | X-01/X-02 |
| 64 | 7062 | Fureasu Co.,Ltd. | excluded | 58.1 | 279 | D | 1.8 | 0.83 | – | X-01/X-02 |
| 65 | 7353 | KIYO Learning Co.,Ltd. | excluded | 58.1 | 280 | C | 3.5 | 2.20 | – | X-01/X-02 |
| 66 | 4017 | CREEMA LTD. | excluded | 58.1 | 281 | B | 1.43 | 1.25 | – | X-01/X-02 |
| 67 | 4170 | Kaizen Platform,Inc. | excluded | 58.1 | 282 | A | 1.93 | 0.67 | – | X-01/X-02 |
| 68 | 4934 | Premier Anti-Aging Co.,Ltd. | excluded | 58.1 | 283 | D | 5.08 | 0.73 | – | X-01/X-02 |
| 69 | 9253 | Slogan Inc. | excluded | 58.1 | 284 | B | 2.31 | 1.24 | – | X-01/X-02 |
| 70 | 2998 | CREAL Inc. | excluded | 58.1 | 285 | C | 17.82 | 1.64 | – | X-01/X-02 |
| 71 | 5136 | tripla Co.,Ltd. | excluded | 58.1 | 286 | B | 14.52 | 6.18 | – | X-01/X-02 |
| 72 | 5590 | NETSTARS Co.,Ltd. | excluded | 58.1 | 287 | B | 12.05 | 1.52 | – | X-01/X-02 |
| 73 | 9162 | Bleach,Inc. | excluded | 58.1 | 288 | A | 5.87 | 0.64 | – | X-01/X-02 |
| 74 | 189A | D&M COMPANY CO.,LTD | excluded | 58.1 | 289 | D | 2.52 | 1.07 | – | X-01/X-02 |
| 75 | 205A | LOGOS HOLDINGS INC. | excluded | 58.1 | 290 | C | 6.49 | 1.60 | – | X-01/X-02 |
| 76 | 2693 | YKT CORPORATION | pass | 57.6 | 305 | A | 3.42 | 0.42 | 1.7% | G2 avoid |
| 77 | 7887 | NANKAI PLYWOOD CO.,LTD. | pass | 57.6 | 307 | D | 7.73 | 0.29 | 13.1% | G2 avoid |
| 78 | 6694 | ZOOM CORPORATION | pass | 56.8 | 332 | A | 3.92 | 0.50 | 3.8% | G2 avoid |
| 79 | 3611 | MATSUOKA CORPORATION | pass | 56.4 | 345 | D | 25.38 | 0.58 | 4.2% | G2 avoid |
| 80 | 5368 | JAPAN INSULATION CO.,LTD. | pass | 56.4 | 346 | D | 8.98 | 0.61 | 3.9% | G2 avoid |
| 81 | 3069 | JFLA Holdings Inc. | pass | 56.2 | 352 | D | 7.58 | 0.74 | 0.0% | G2 avoid |
| 82 | 4222 | KODAMA CHEMICAL INDUSTRY CO.,LTD. | pass | 56.2 | 357 | C | 10.2 | 0.33 | 1.5% | G2 avoid |
| 83 | 7261 | Mazda Motor Corporation | pass | 55.8 | 368 | C | 699.72 | 0.36 | 5.0% | G2 avoid |
| 84 | 3321 | MITACHI CO.,LTD. | pass | 55.7 | 371 | A | 15.06 | 0.84 | 4.2% | G2 avoid |
| 85 | 1850 | Nankai Tatsumura Construction Co.,Ltd. | pass | 55.6 | 374 | A | 12.14 | 0.62 | 1.9% | G2 avoid |
| 86 | 5905 | NIHON SEIKAN K.K. | pass | 55.6 | 379 | C | 1.9 | 0.38 | 1.5% | G2 avoid |
| 87 | 3236 | PROPERST CO.,LTD. | pass | 55.5 | 381 | C | 9.81 | 0.57 | 2.9% | G2 avoid |
| 88 | 7280 | MITSUBA Corporation | pass | 55.5 | 380 | C | 62.17 | 0.45 | 1.9% | G2 avoid |
| 89 | 6844 | Shindengen Electric Manufacturing Co.,Ltd. | pass | 55.4 | 383 | C | 31.48 | 0.43 | 3.3% | G2 avoid |
| 90 | 2788 | APPLE INTERNATIONAL CO.,LTD. | pass | 55.3 | 386 | A | 5.69 | 0.50 | 2.5% | G2 avoid |
| 91 | 6635 | KK DI-NIKKO ENGINEERING | pass | 54.8 | 402 | C | 4.56 | 0.49 | 2.4% | G2 avoid |
| 92 | 3352 | BUFFALO CO.,LTD. | pass | 54.7 | 405 | D | 4.19 | 0.64 | 3.6% | G2 avoid |
| 93 | 3435 | SANKO TECHNO CO.,LTD. | pass | 54.6 | 408 | D | 12.8 | 0.63 | 2.9% | G2 avoid |
| 94 | 5820 | MITSUBOSHI CO.,LTD. | excluded | 54.6 | 407 | D | 3.97 | 0.53 | 1.9% | X-22/R-15, G2 avoid |
| 95 | 5816 | Onamba Co.,Ltd. | pass | 54.4 | 411 | D | 18.1 | 0.60 | 2.8% | G2 avoid |
| 96 | 3490 | Azplanning Co.,Ltd. | pass | 53.8 | 421 | C | 4.71 | 1.11 | 1.0% | eligible |
| 97 | 5189 | SAKURA RUBBER CO.,LTD. | pass | 53.7 | 425 | D | 7.01 | 0.70 | 2.9% | G2 avoid |
| 98 | 5079 | NOVAC CO.,LTD. | pass | 53.7 | 424 | A | 13.5 | 0.73 | 4.6% | G2 avoid |
| 99 | 5986 | MOLITEC STEEL CO.,LTD. | pass | 53.6 | 429 | D | 6.45 | 0.39 | 4.2% | G2 avoid |
| 100 | 4243 | NIX,INC. | excluded | 53.5 | 434 | A | 2.53 | 0.52 | 1.8% | X-22/R-15, G2 avoid |
| 101 | 3675 | Cross Marketing Group Inc. | pass | 53.4 | 436 | C | 11.8 | 1.41 | 2.5% | eligible |
| 102 | 7953 | KIKUSUI CHEMICAL INDUSTRIES CO.,LTD. | pass | 53.3 | 438 | D | 5.14 | 0.49 | 4.2% | G2 avoid |
| 103 | 2884 | Yoshimura Food Holdings K.K. | pass | 53.2 | 440 | D | 14.53 | 0.72 | 0.0% | G2 avoid |
| 104 | 7885 | TAKANO Co.,Ltd. | pass | 53.1 | 442 | A | 16.9 | 0.52 | 1.9% | G2 avoid |
| 105 | 6982 | The Lead Co.,Inc. | pass | 53.0 | 449 | C | 1.51 | 0.60 | 1.7% | G2 avoid |
| 106 | 7983 | Miroku Corporation | pass | 53.0 | 450 | D | 3.48 | 0.30 | 0.9% | G2 avoid |
| 107 | 9791 | BIKEN TECHNO CORPORATION | pass | 52.5 | 463 | D | 9.07 | 0.39 | 3.1% | G2 avoid |
| 108 | 7264 | MURO CORPORATION | pass | 52.4 | 465 | A | 8.89 | 0.39 | 3.4% | G2 avoid |
| 109 | 4224 | LONSEAL CORPORATION | pass | 52.1 | 473 | A | 9.82 | 0.50 | 4.0% | G2 avoid |
| 110 | 3895 | HAVIX CORPORATION | pass | 52.0 | 483 | C | 3.62 | 0.47 | 3.6% | G2 avoid |
| 111 | 7038 | Frontier Management Inc. | pass | 51.9 | 488 | C | 6.81 | 0.69 | 0.0% | G2 avoid |
| 112 | 9519 | RENOVA,Inc. | pass | 51.8 | 492 | C | 73.22 | 0.37 | 0.0% | G2 avoid |
| 113 | 2982 | A.D.Works Group Co.,Ltd. | pass | 51.8 | 490 | D | 21.16 | 0.95 | 3.8% | G2 avoid |
| 114 | 5962 | ASAKA INDUSTRIAL CO.,LTD. | pass | 51.6 | 499 | A | 2.24 | 0.48 | 4.2% | G2 avoid |
| 115 | 6633 | CGS HOLDINGS INC. | pass | 51.6 | 497 | B | 3.07 | 0.91 | 3.2% | G2 avoid |
| 116 | 7812 | CRESTEC Inc. | pass | 51.3 | 513 | C | 6.83 | 0.62 | 4.9% | G2 avoid |
| 117 | 8093 | Kyokuto Boeki Kaisha,Limited | pass | 51.3 | 514 | D | 21.4 | 0.65 | 4.2% | G2 avoid |
| 118 | 6063 | Emergency Assistance Japan Co., Ltd. | pass | 51.2 | 515 | C | 2.48 | 1.26 | 0.9% | eligible |
| 119 | 6390 | KATO WORKS CO.,LTD. | pass | 51.2 | 516 | A | 15.08 | 0.36 | 5.5% | G2 avoid |
| 120 | 1928 | Sekisui House,Ltd. | pass | 51.1 | 519 | D | 2161.31 | 0.94 | 4.3% | G2 avoid |
| 121 | 1420 | Sanyo Homes Corporation | pass | 50.5 | 542 | A | 8.64 | 0.53 | 4.0% | G2 avoid |
| 122 | 7277 | TBK Co.,Ltd. | pass | 50.5 | 541 | D | 10.69 | 0.33 | 2.4% | G2 avoid |
| 123 | 4341 | SEIRYO ELECTRIC CORPORATION | pass | 50.4 | 547 | A | 3.18 | 0.60 | 3.6% | G2 avoid |
| 124 | 4406 | New Japan Chemical Co.,Ltd. | excluded | 50.4 | 544 | D | 8.99 | 0.41 | 1.9% | X-22/R-15, G2 avoid |
| 125 | 6943 | NKK SWITCHES CO.,LTD. | pass | 50.3 | 550 | A | 5.1 | 0.36 | 2.0% | G2 avoid |
| 126 | 7628 | OHASHI TECHNICA INC. | pass | 50.1 | 559 | A | 29.11 | 0.70 | 3.0% | G2 avoid |
| 127 | 6899 | ASTI CORPORATION | pass | 50.0 | 560 | A | 7.59 | 0.30 | 3.6% | G2 avoid |
| 128 | 8881 | NISSHIN GROUP HOLDINGS Company,Limited | pass | 50.0 | 561 | C | 30.42 | 0.43 | 5.4% | G2 avoid |
| 129 | 6964 | SANKO CO.,LTD. | pass | 49.8 | 566 | A | 6.23 | 0.38 | 2.9% | G2 avoid |
| 130 | 7368 | HYOJITO Co.,Ltd. | pass | 49.2 | 583 | C | 8.17 | 0.96 | 3.6% | G2 avoid |
| 131 | 2415 | Human Holdings Co.,Ltd. | pass | 49.1 | 588 | B | 16.51 | 0.85 | 4.3% | G2 avoid |
| 132 | 5697 | SANYU CO.,LTD. | pass | 48.8 | 599 | A | 4.99 | 0.45 | 3.7% | G2 avoid |
| 133 | 6822 | Oi Electric Co.,Ltd. | pass | 48.8 | 597 | D | 7.35 | 0.68 | 1.4% | G2 avoid |
| 134 | 8046 | MARUFUJI SHEET PILING CO.,LTD. | pass | 48.7 | 601 | D | 19.7 | 0.61 | 20.3% | G2 avoid |
| 135 | 4925 | HABA LABORATORIES,INC. | pass | 48.3 | 612 | D | 6.61 | 0.71 | 2.4% | G2 avoid |
| 136 | 8999 | Grandy House Corporation | pass | 48.3 | 613 | D | 17.35 | 0.70 | 5.7% | G2 avoid |
| 137 | 3970 | Innovation Inc. | pass | 48.1 | 618 | C | 2.33 | 0.67 | 4.8% | G2 avoid |
| 138 | 2795 | NIPPON PRIMEX INC. | pass | 48.0 | 619 | B | 5.41 | 0.63 | 2.6% | G2 avoid |
| 139 | 3863 | Nippon Paper Industries Co.,Ltd. | pass | 47.9 | 622 | C | 151.83 | 0.28 | 1.1% | G2 avoid |
| 140 | 8147 | TOMITA CO.LTD. | pass | 47.8 | 627 | D | 9.03 | 0.65 | 1.6% | G2 avoid |
| 141 | 6408 | OGURA CLUTCH CO.,LTD. | pass | 47.7 | 628 | C | 6.87 | 0.34 | 2.3% | G2 avoid |
| 142 | 5658 | NICHIA STEEL WORKS,LTD. | pass | 47.6 | 634 | D | 20.75 | 0.36 | 2.5% | G2 avoid |
| 143 | 7531 | SEIWA CHUO HOLDINGS CORPORATION | pass | 47.2 | 653 | A | 5.21 | 0.32 | 1.5% | G2 avoid |
| 144 | 7614 | OM2Network Co.,Ltd. | pass | 47.0 | 659 | C | 11.32 | 0.62 | 2.3% | G2 avoid |
| 145 | 9478 | SE Holdings and Incubations Co.,Ltd. | pass | 47.0 | 661 | A | 8.13 | 0.68 | 0.8% | G2 avoid |
| 146 | 7218 | TANAKA SEIMITSU KOGYO CO.,LTD. | pass | 46.9 | 665 | C | 11.32 | 0.33 | 2.8% | G2 avoid |
| 147 | 6186 | ICHIKURA CO.,LTD. | pass | 46.7 | 668 | C | 2.06 | 0.91 | 3.8% | G2 avoid |
| 148 | 7214 | GMB CORPORATION | pass | 46.7 | 667 | C | 6.01 | 0.18 | 3.6% | G2 avoid |
| 149 | 7219 | HKS CO.,LTD. | pass | 46.6 | 672 | A | 3.95 | 0.35 | 2.6% | G2 avoid |
| 150 | 3437 | TOKUDEN CO.,LTD. | pass | 46.5 | 673 | D | 4.2 | 0.53 | 3.8% | G2 avoid |
| 151 | 7997 | Kurogane Kosakusho Ltd. | pass | 46.5 | 677 | D | 2.13 | 0.45 | 3.5% | G2 avoid |
| 152 | 4361 | KAWAGUCHI CHEMICAL INDUSTRY CO.,LTD. | excluded | 46.0 | 690 | C | 1.99 | 0.60 | 3.7% | X-22/R-15, G2 avoid |
| 153 | 6218 | ENSHU Limited | pass | 46.0 | 692 | D | 4.06 | 0.38 | 1.6% | G2 avoid |
| 154 | 4119 | Nippon Pigment Holdings Company Limited | excluded | 45.9 | 694 | D | 9.93 | 0.40 | 1.9% | X-22/R-15, G2 avoid |
| 155 | 7521 | MUSASHI CO.,LTD. | pass | 45.8 | 696 | C | 21.04 | 0.57 | 2.9% | G2 avoid |
| 156 | 7247 | MIKUNI CORPORATION | pass | 45.7 | 699 | D | 12.29 | 0.29 | 3.9% | G2 avoid |
| 157 | 2193 | Cookpad Inc. | pass | 45.5 | 702 | A | 10.01 | 0.75 | 0.0% | G2 avoid |
| 158 | 3291 | Iida Group Holdings Co.,Ltd. | pass | 45.4 | 705 | D | 606.32 | 0.59 | 4.6% | G2 avoid |
| 159 | 3159 | Maruzen CHI Holdings Co.,Ltd. | pass | 45.3 | 707 | D | 35.36 | 0.62 | 1.6% | G2 avoid |
| 160 | 6054 | Livesense Inc. | pass | 45.3 | 710 | A | 3.1 | 0.77 | 0.0% | G2 avoid |
| 161 | 6150 | TAKEDA MACHINERY CO.,LTD. | pass | 45.3 | 711 | A | 2.85 | 0.52 | 2.9% | G2 avoid |
| 162 | 3396 | FELISSIMO CORPORATION | pass | 45.2 | 713 | A | 8.2 | 0.42 | 2.3% | G2 avoid |
| 163 | 6718 | AIPHONE CO.,LTD. | pass | 45.1 | 718 | D | 48.42 | 0.69 | 4.7% | G2 avoid |
| 164 | 3632 | GREE Holdings,Inc. | pass | 45.0 | 720 | A | 76.03 | 0.79 | 5.2% | G2 avoid |
| 165 | 6464 | TSUBAKI NAKASHIMA CO.,LTD. | pass | 45.0 | 721 | C | 14.02 | 0.36 | 0.0% | G2 avoid |
| 166 | 5199 | FUJI LATEX CO.,LTD. | pass | 44.6 | 729 | C | 2.56 | 0.63 | 4.1% | G2 avoid |
| 167 | 2055 | NICHIWA SANGYO CO.,LTD. | pass | 44.5 | 734 | A | 7.17 | 0.37 | 1.7% | G2 avoid |
| 168 | 5204 | ISHIZUKA GLASS CO.,LTD. | pass | 44.5 | 732 | D | 12.97 | 0.32 | 2.3% | G2 avoid |
| 169 | 9767 | NIKKEN KOGAKU CO.,LTD. | pass | 44.2 | 742 | D | 3.21 | 0.64 | 1.7% | G2 avoid |
| 170 | 8138 | SANKYO KASEI CORPORATION | pass | 44.1 | 749 | D | 4.72 | 0.50 | 2.4% | G2 avoid |
| 171 | 3440 | NISSO GROUP Co.,Ltd. | pass | 44.1 | 748 | C | 5.88 | 0.47 | 4.6% | G2 avoid |
| 172 | 9603 | H.I.S.Co.,Ltd. | pass | 44.0 | 751 | C | 86.25 | 1.31 | 1.9% | eligible |
| 173 | 9229 | SUNWELS Co.,Ltd. | pass | 44.0 | 750 | C | 3.87 | 0.60 | 0.0% | G2 avoid |
| 174 | 7284 | MEIWA INDUSTRY CO.,LTD. | pass | 43.8 | 755 | C | 4.13 | 0.34 | 4.2% | G2 avoid |
| 175 | 1798 | MORIYA CORPORATION | pass | 43.7 | 761 | D | 12.43 | 0.66 | 16.4% | G2 avoid |
| 176 | 5994 | FINE SINTER CO.,LTD. | pass | 43.7 | 759 | C | 4.36 | 0.29 | 2.5% | G2 avoid |
| 177 | 6165 | PUNCH INDUSTRY CO.,LTD. | pass | 43.7 | 762 | D | 14.97 | 0.62 | 3.6% | G2 avoid |
| 178 | 5966 | KYOTO TOOL CO.,LTD. | pass | 43.6 | 765 | D | 7.03 | 0.54 | 3.0% | G2 avoid |
| 179 | 3189 | ANAP HOLDINGS INC. | pass | 43.5 | 773 | A | 4.83 | 0.65 | 0.0% | G2 avoid |
| 180 | 5949 | UNIPRES CORPORATION | pass | 43.5 | 772 | D | 57.88 | 0.38 | 4.7% | G2 avoid |
| 181 | 3668 | COLOPL,Inc. | pass | 43.4 | 774 | D | 56.18 | 0.84 | 4.6% | G2 avoid |
| 182 | 3953 | OHMURA SHIGYO CO.,LTD. | excluded | 43.4 | 778 | D | 2.85 | 0.56 | 3.8% | X-22/R-15, G2 avoid |
| 183 | 8076 | CANOX CORPORATION | pass | 43.4 | 775 | D | 23.15 | 0.69 | 5.0% | G2 avoid |
| 184 | 5984 | KANEFUSA CORPORATION | pass | 42.9 | 791 | A | 10.93 | 0.34 | 3.4% | G2 avoid |
| 185 | 1301 | KYOKUYO CO.,LTD. | pass | 42.8 | 794 | D | 55.56 | 0.69 | 3.3% | G2 avoid |
| 186 | 9115 | Meiji Shipping Group Co.,Ltd. | pass | 42.8 | 793 | C | 37.12 | 0.37 | 0.5% | G2 avoid |
| 187 | 7822 | Eidai Co.,Ltd. | pass | 42.7 | 798 | D | 11.98 | 0.32 | 3.9% | G2 avoid |
| 188 | 6867 | LEADER ELECTRONICS CORPORATION | pass | 42.6 | 799 | A | 1.85 | 0.54 | 3.7% | G2 avoid |
| 189 | 2429 | WORLD HOLDINGS CO.,LTD. | pass | 42.2 | 806 | D | 50.85 | 0.96 | 4.6% | G2 avoid |
| 190 | 5410 | Godo Steel,Ltd. | pass | 42.2 | 804 | D | 49.5 | 0.35 | 6.2% | G2 avoid |
| 191 | 7427 | ECHO TRADING CO.,LTD. | pass | 41.9 | 815 | A | 5.13 | 0.43 | 3.6% | G2 avoid |
| 192 | 8165 | SENSHUKAI CO.,LTD. | pass | 41.9 | 812 | A | 5.26 | 0.31 | 0.0% | G2 avoid |
| 193 | 5283 | TAKAMISAWA CO.,LTD. | pass | 41.8 | 816 | D | 5.57 | 0.35 | 2.2% | G2 avoid |
| 194 | 9444 | TOSHIN HOLDINGS CO.,LTD | pass | 41.8 | 820 | C | 1.78 | 1.99 | 3.7% | eligible |
| 195 | 2499 | NIHONWASOU HOLDINGS,INC. | pass | 41.7 | 821 | A | 2.75 | 0.76 | 5.3% | G2 avoid |
| 196 | 7238 | AKEBONO BRAKE INDUSTRY CO.,LTD. | excluded | 41.6 | 824 | D | 28.74 | 0.50 | 0.0% | X-22/R-15, G2 avoid |
| 197 | 7841 | ENDO MANUFACTURING CO.,LTD. | pass | 41.4 | 830 | A | 10.22 | 0.44 | 3.7% | G2 avoid |
| 198 | 2999 | Home Position Co.,Ltd. | pass | 41.4 | 829 | A | 4.87 | 0.81 | 1.9% | G2 avoid |
| 199 | 6615 | UMC Electronics Co.,Ltd. | pass | 41.3 | 833 | C | 6.7 | 0.39 | 4.2% | G2 avoid |
| 200 | 5491 | NIPPON KINZOKU CO.,LTD. | pass | 41.2 | 836 | C | 5.98 | 0.20 | 0.6% | G2 avoid |
| 201 | 5909 | CORONA CORPORATION | pass | 41.2 | 835 | A | 27.35 | 0.36 | 3.0% | G2 avoid |
| 202 | 1764 | KUDO CORPORATION | pass | 41.1 | 840 | C | 3.55 | 0.60 | 4.8% | G2 avoid |
| 203 | 7291 | NIHON PLAST CO.,LTD. | pass | 41.1 | 839 | C | 8.79 | 0.23 | 6.6% | G2 avoid |
| 204 | 6748 | SEIWA ELECTRIC MFG. CO.,LTD. | pass | 41.0 | 844 | D | 10.23 | 0.50 | 2.6% | G2 avoid |
| 205 | 8152 | SOMAR CORPORATION | pass | 41.0 | 843 | D | 14.08 | 0.60 | 1.4% | G2 avoid |
| 206 | 6228 | J.E.T.Co.,LTD. | pass | 41.0 | 842 | D | 8.37 | 0.96 | 0.0% | G2 avoid |
| 207 | 7681 | LEOCLAN Co.,Ltd. | pass | 40.8 | 851 | C | 5.89 | 0.98 | 1.7% | G2 avoid |
| 208 | 5408 | NAKAYAMA STEEL WORKS,LTD. | pass | 40.7 | 855 | A | 39.05 | 0.35 | 2.3% | G2 avoid |
| 209 | 6424 | TAKAMISAWA CYBERNETICS COMPANY,LTD. | pass | 40.7 | 853 | D | 4.0 | 0.67 | 2.6% | G2 avoid |
| 210 | 6664 | OPTOELECTRONICS CO.,LTD. | pass | 40.7 | 854 | A | 3.9 | 0.51 | 0.0% | G2 avoid |
| 211 | 2917 | OHMORIYA Co.,LTD. | pass | 40.4 | 860 | A | 4.54 | 0.39 | 1.1% | G2 avoid |
| 212 | 6059 | UCHIYAMA HOLDINGS Co.,Ltd. | pass | 40.4 | 861 | C | 8.04 | 0.53 | 2.7% | G2 avoid |
| 213 | 7837 | R.C.CORE CO.,LTD. | pass | 40.4 | 859 | B | 1.57 | 1.11 | 0.0% | eligible |
| 214 | 7859 | ALMEDIO INC. | pass | 40.4 | 862 | A | 5.33 | 0.68 | 1.8% | G2 avoid |
| 215 | 5932 | Sankyo Tateyama,Inc. | pass | 40.3 | 865 | C | 20.64 | 0.22 | 3.8% | G2 avoid |
| 216 | 6837 | KYOSHA CO.,LTD. | pass | 40.3 | 863 | C | 6.23 | 0.59 | 1.2% | G2 avoid |
| 217 | 5280 | Yoshicon Co.,Ltd. | pass | 40.2 | 868 | A | 17.47 | 0.61 | 3.9% | G2 avoid |
| 218 | 9972 | ALTECH CO.,LTD. | pass | 40.0 | 873 | A | 4.29 | 0.47 | 2.5% | G2 avoid |
| 219 | 2168 | Pasona Group Inc. | pass | 39.8 | 882 | C | 61.81 | 0.47 | 4.9% | G2 avoid |
| 220 | 7795 | KYORITSU CO.,LTD. | pass | 39.8 | 883 | C | 10.49 | 0.59 | 3.8% | G2 avoid |
| 221 | 6470 | TAIHO KOGYO CO.,LTD. | pass | 39.6 | 890 | D | 33.37 | 0.51 | 2.4% | G2 avoid |
| 222 | 7215 | FALTEC Co.,Ltd. | pass | 39.6 | 891 | C | 3.89 | 0.18 | 0.0% | G2 avoid |
| 223 | 9206 | Star Flyer Inc. | pass | 39.4 | 895 | C | 7.35 | 2.03 | 0.0% | eligible |
| 224 | 6339 | Sintokogio,Ltd. | pass | 39.3 | 899 | D | 63.7 | 0.52 | 3.8% | G2 avoid |
| 225 | 8860 | FUJI CORPORATION LIMITED | pass | 39.1 | 904 | D | 26.61 | 0.45 | 4.4% | G2 avoid |
| 226 | 6986 | FUTABA CORPORATION | pass | 39.0 | 907 | A | 31.06 | 0.33 | 2.5% | G2 avoid |
| 227 | 7613 | SIIX CORPORATION | pass | 38.6 | 919 | D | 80.49 | 0.73 | 3.1% | G2 avoid |
| 228 | 7827 | ORVIS CORPORATION | pass | 38.5 | 924 | D | 3.22 | 0.56 | 3.3% | G2 avoid |
| 229 | 3267 | Phil Company,Inc. | pass | 38.4 | 927 | D | 3.58 | 1.08 | 3.2% | eligible |
| 230 | 8041 | OUG Holdings Inc. | pass | 38.1 | 937 | D | 24.53 | 0.59 | 3.8% | G2 avoid |
| 231 | 1911 | Sumitomo Forestry Co.,Ltd. | pass | 37.9 | 943 | D | 733.0 | 0.59 | 4.1% | G2 avoid |
| 232 | 4231 | TIGERS POLYMER CORPORATION | pass | 37.9 | 941 | A | 20.45 | 0.40 | 3.7% | G2 avoid |
| 233 | 3903 | gumi Inc. | pass | 37.7 | 947 | A | 10.89 | 0.54 | 0.0% | G2 avoid |
| 234 | 6222 | SHIMA SEIKI MFG.,LTD. | pass | 37.7 | 946 | A | 31.77 | 0.38 | 2.2% | G2 avoid |
| 235 | 5753 | NIPPON SHINDO CO.,LTD. | excluded | 37.5 | 952 | A | 6.07 | 0.47 | 0.6% | X-22/R-15, G2 avoid |
| 236 | 6249 | Gamecard Holdings,Inc. | pass | 37.5 | 951 | A | 41.18 | 0.68 | 3.6% | G2 avoid |
| 237 | 7879 | NODA CORPORATION | pass | 37.5 | 953 | C | 11.62 | 0.30 | 4.9% | G2 avoid |
| 238 | 2428 | WELLNET CORPORATION | pass | 37.4 | 957 | C | 12.05 | 1.30 | 4.8% | eligible |
| 239 | 9726 | KNT-CT Holdings Co.,Ltd. | pass | 37.4 | 956 | B | 54.52 | 1.58 | 0.5% | eligible |
| 240 | 2993 | Choei Inc. | pass | 37.3 | 960 | C | 9.8 | 0.84 | 5.7% | G2 avoid |
| 241 | 6292 | KAWATA MFG. CO.,LTD. | pass | 37.2 | 962 | A | 6.11 | 0.45 | 4.5% | G2 avoid |
| 242 | 5915 | KOMAIHALTEC Inc. | pass | 37.1 | 963 | D | 12.04 | 0.35 | 2.9% | G2 avoid |
| 243 | 3758 | Aeria Inc. | pass | 36.9 | 969 | C | 5.23 | 0.57 | 2.0% | G2 avoid |
| 244 | 4644 | Imagineer Co.,Ltd. | pass | 36.9 | 973 | A | 10.93 | 0.88 | 5.8% | G2 avoid |
| 245 | 5819 | Canare Electric Co.,Ltd. | pass | 36.8 | 976 | A | 12.12 | 0.62 | 3.8% | G2 avoid |
| 246 | 8219 | AOYAMA TRADING Co.,Ltd. | pass | 36.8 | 975 | D | 108.7 | 0.61 | 18.9% | G2 avoid |
| 247 | 1853 | Mori-Gumi Co.,Ltd. | pass | 36.5 | 986 | A | 10.66 | 0.69 | 4.3% | G2 avoid |
| 248 | 8904 | AVANTIA CO.,LTD. | pass | 36.4 | 988 | A | 12.23 | 0.44 | 4.6% | G2 avoid |
| 249 | 1382 | HOB Co.,Ltd. | pass | 36.3 | 994 | D | 0.57 | 0.83 | 6.7% | G2 avoid |
| 250 | 2484 | DEMAE-CAN CO.,LTD | pass | 36.3 | 999 | A | 16.75 | 0.75 | 0.0% | G2 avoid |
| 251 | 7399 | NANSIN CO.,LTD. | pass | 36.3 | 992 | A | 4.73 | 0.40 | 3.3% | G2 avoid |
| 252 | 7442 | NAKAYAMAFUKU CO.,LTD. | pass | 36.3 | 993 | A | 9.68 | 0.42 | 2.5% | G2 avoid |
| 253 | 7603 | Gyet Co.,Ltd. | pass | 36.3 | 997 | D | 2.85 | 0.90 | 0.0% | G2 avoid |
| 254 | 6699 | DIAMOND ELECTRIC HOLDINGS Co.,Ltd. | pass | 36.2 | 1002 | C | 6.29 | 0.42 | 5.2% | G2 avoid |
| 255 | 8281 | XEBIO holdings CO.,LTD. | pass | 36.1 | 1004 | D | 53.23 | 0.44 | 3.2% | G2 avoid |
| 256 | 8119 | SANYEI CORPORATION | pass | 36.0 | 1006 | D | 8.02 | 0.53 | 3.9% | G2 avoid |
| 257 | 5440 | KYOEI STEEL LTD. | pass | 35.9 | 1012 | D | 86.34 | 0.39 | 4.7% | G2 avoid |
| 258 | 5923 | TAKADAKIKO(Steel Construction)CO.,LTD. | pass | 35.9 | 1013 | D | 7.93 | 0.39 | 4.2% | G2 avoid |
| 259 | 7266 | Imasen Electric Industrial Co.,Ltd. | excluded | 35.9 | 1014 | A | 21.95 | 0.38 | 2.8% | X-22/R-15, G2 avoid |
| 260 | 6513 | Origin Company,Limited | pass | 35.8 | 1016 | D | 8.66 | 0.33 | 2.7% | G2 avoid |
| 261 | 8917 | First Juken Co.,Ltd. | pass | 35.7 | 1021 | A | 18.42 | 0.43 | 3.9% | G2 avoid |
| 262 | 9760 | SHINGAKUKAI HOLDINGS CO.,LTD. | pass | 35.4 | 1030 | C | 2.34 | 0.37 | 0.0% | G2 avoid |
| 263 | 8144 | Denkyo Group Holdings Co.,Ltd. | pass | 35.3 | 1032 | A | 8.35 | 0.31 | 3.4% | G2 avoid |
| 264 | 6467 | NICHIDAI CORPORATION | pass | 35.2 | 1038 | A | 3.17 | 0.30 | 1.1% | G2 avoid |
| 265 | 5446 | HOKUETSU METAL Co.,Ltd. | pass | 35.0 | 1042 | D | 4.29 | 0.24 | 0.4% | G2 avoid |
| 266 | 9625 | CERESPO CO.,LTD. | pass | 34.9 | 1043 | C | 5.34 | 0.56 | 4.3% | G2 avoid |
| 267 | 2138 | CROOZ,Inc. | pass | 34.6 | 1054 | C | 5.51 | 0.64 | 0.0% | G2 avoid |
| 268 | 3577 | Tokai Senko K.K. | pass | 34.6 | 1058 | D | 3.32 | 0.34 | 2.7% | G2 avoid |
| 269 | 3059 | HIRAKI CO.,LTD. | pass | 34.5 | 1060 | C | 3.65 | 0.61 | 2.8% | G2 avoid |
| 270 | 7422 | TOHO LAMAC CO.,LTD. | pass | 34.4 | 1064 | D | 2.48 | 0.56 | 2.4% | G2 avoid |
| 271 | 8141 | Shinko Shoji Co.,Ltd. | pass | 34.4 | 1061 | D | 48.72 | 0.90 | 1.2% | G2 avoid |
| 272 | 5940 | FUJISASH CO.,LTD. | pass | 34.3 | 1065 | C | 9.46 | 0.38 | 4.0% | G2 avoid |
| 273 | 5928 | ALMETAX MANUFACTURING CO,LTD. | pass | 34.2 | 1068 | D | 3.42 | 0.37 | 2.8% | G2 avoid |
| 274 | 5956 | TOSO CO.,LTD. | pass | 34.1 | 1069 | A | 5.77 | 0.36 | 2.7% | G2 avoid |
| 275 | 6262 | PEGASUS CO.,LTD. | pass | 33.8 | 1078 | A | 13.06 | 0.38 | 5.7% | G2 avoid |
| 276 | 3597 | JICHODO Co.,Ltd. | pass | 33.7 | 1080 | A | 25.86 | 0.67 | 5.6% | G2 avoid |
| 277 | 6393 | YUKEN KOGYO CO.,LTD. | pass | 33.6 | 1081 | D | 13.76 | 0.49 | 4.9% | G2 avoid |
| 278 | 7270 | SUBARU CORPORATION | pass | 33.5 | 1084 | D | 1817.73 | 0.66 | 4.6% | G2 avoid |
| 279 | 7702 | JMS CO.,LTD. | pass | 33.4 | 1088 | D | 11.13 | 0.27 | 3.8% | G2 avoid |
| 280 | 8078 | HANWA CO.,LTD. | pass | 33.3 | 1090 | D | 390.73 | 0.88 | 15.7% | G2 avoid |
| 281 | 3420 | KFC Ltd | pass | 33.2 | 1095 | D | 11.66 | 0.53 | 4.1% | G2 avoid |
| 282 | 3760 | CAVE Interactive CO.,LTD. | pass | 33.2 | 1097 | C | 5.01 | 1.37 | 0.0% | eligible |
| 283 | 7537 | MARUBUN CORPORATION | pass | 32.8 | 1102 | D | 52.68 | 0.83 | 2.7% | G2 avoid |
| 284 | 5187 | CREATE MEDIC CO.,LTD. | pass | 32.6 | 1104 | D | 11.19 | 0.68 | 3.9% | G2 avoid |
| 285 | 7297 | CAR MATE MFG. CO.,LTD. | pass | 32.6 | 1108 | A | 6.86 | 0.45 | 3.5% | G2 avoid |
| 286 | 7464 | SAFTEC CO.,LTD. | pass | 32.6 | 1106 | C | 3.06 | 0.43 | 3.9% | G2 avoid |
| 287 | 1966 | TAKADA CORPORATION | pass | 32.5 | 1109 | D | 12.72 | 0.58 | 4.0% | G2 avoid |
| 288 | 6158 | WAIDA MFG.CO.,LTD. | pass | 32.2 | 1115 | D | 7.13 | 0.67 | 3.4% | G2 avoid |
| 289 | 7815 | TOKYO BOARD INDUSTRIES CO.,LTD. | pass | 32.0 | 1117 | C | 1.28 | 0.87 | 0.0% | G2 avoid |
| 290 | 7957 | FUJICOPIAN CO.,LTD. | pass | 31.6 | 1119 | D | 4.25 | 0.49 | 1.7% | G2 avoid |
| 291 | 8835 | TAIHEIYO KOUHATSU INCORPORATED | pass | 31.5 | 1120 | C | 6.09 | 0.38 | 5.1% | G2 avoid |
| 292 | 3139 | Lacto Japan Co.,Ltd. | pass | 31.4 | 1121 | D | 34.32 | 1.03 | 3.9% | eligible |
| 293 | 6346 | KIKUKAWA ENTERPRISE,INC. | pass | 31.3 | 1126 | A | 7.33 | 0.56 | 1.8% | G2 avoid |
| 294 | 4569 | KYORIN Pharmaceutical Co.,Ltd. | pass | 31.1 | 1130 | A | 66.42 | 0.47 | 5.1% | G2 avoid |
| 295 | 9885 | CHARLE CO.,LTD. | pass | 31.0 | 1133 | A | 5.33 | 0.42 | 2.4% | G2 avoid |
| 296 | 9895 | CONSEC CORPORATION | pass | 31.0 | 1131 | D | 2.34 | 0.29 | 2.1% | G2 avoid |
| 297 | 7916 | MITSUMURA PRINTING CO.,LTD. | pass | 30.5 | 1139 | C | 5.79 | 0.29 | 2.7% | G2 avoid |
| 298 | 5900 | DAIKEN CO.,LTD. | pass | 30.4 | 1141 | A | 5.08 | 0.38 | 2.4% | G2 avoid |
| 299 | 7551 | WEDS CO.,LTD. | pass | 30.4 | 1140 | D | 10.81 | 0.56 | 4.0% | G2 avoid |
| 300 | 3426 | ATOM LIVIN TECH Co.,Ltd. | pass | 30.3 | 1142 | D | 5.34 | 0.50 | 2.6% | G2 avoid |
| 301 | 7871 | FUKUVI CHEMICAL INDUSTRY CO.,LTD. | excluded | 30.1 | 1148 | D | 20.89 | 0.51 | 2.9% | X-22/R-15, G2 avoid |
| 302 | 5078 | CEL Corporation | pass | 30.1 | 1146 | A | 16.41 | 0.81 | 2.9% | G2 avoid |
| 303 | 7991 | MAMIYA-OP CO.,LTD | pass | 29.9 | 1150 | D | 11.12 | 0.43 | 4.7% | G2 avoid |
| 304 | 8091 | NICHIMO CO.,LTD. | pass | 29.8 | 1154 | D | 21.21 | 0.61 | 4.2% | G2 avoid |
| 305 | 8013 | NAIGAI CO.,LTD. | pass | 29.3 | 1160 | D | 3.12 | 0.43 | 0.0% | G2 avoid |
| 306 | 9896 | JK Holdings Co.,Ltd. | pass | 29.1 | 1165 | C | 43.18 | 0.64 | 4.0% | G2 avoid |
| 307 | 3641 | PAPYLESS CO.,LTD. | pass | 29.0 | 1166 | B | 10.3 | 1.16 | 1.0% | eligible |
| 308 | 7538 | DAISUI CO.,LTD. | pass | 28.1 | 1181 | D | 5.32 | 0.42 | 1.8% | G2 avoid |
| 309 | 3320 | CROSS PLUS INC. | pass | 27.8 | 1183 | D | 10.03 | 0.52 | 3.8% | G2 avoid |
| 310 | 8040 | TOKYO SOIR CO.,LTD. | pass | 27.7 | 1185 | A | 4.08 | 0.38 | 4.3% | G2 avoid |
| 311 | 3161 | AZEARTH Corporation | pass | 27.6 | 1188 | A | 4.1 | 0.61 | 3.4% | G2 avoid |
| 312 | 8089 | Nice Corporation | pass | 27.3 | 1194 | C | 23.69 | 0.36 | 3.7% | G2 avoid |
| 313 | 5971 | KYOWAKOGYOSYO CO.,LTD. | pass | 27.2 | 1195 | D | 11.97 | 0.68 | 0.9% | G2 avoid |
| 314 | 6584 | Sanoh Industrial Co.,Ltd. | pass | 25.8 | 1213 | D | 29.17 | 0.56 | 3.6% | G2 avoid |
| 315 | 7514 | HIMARAYA Co.,Ltd. | pass | 25.8 | 1215 | D | 10.53 | 0.66 | 3.0% | G2 avoid |
| 316 | 6155 | TAKAMATSU MACHINERY CO.,LTD. | pass | 25.5 | 1216 | A | 5.94 | 0.36 | 1.9% | G2 avoid |
| 317 | 4735 | KYOSHIN CO.,LTD. | pass | 25.4 | 1217 | C | 2.35 | 0.64 | 1.8% | G2 avoid |
| 318 | 8029 | LOOK HOLDINGS INCORPORATED | pass | 24.5 | 1222 | D | 21.22 | 0.51 | 3.7% | G2 avoid |
| 319 | 7040 | SUN-LIFE HOLDING CO.,LTD. | pass | 24.4 | 1223 | B | 6.59 | 0.95 | 3.5% | G2 avoid |
| 320 | 3280 | STrust Co.,Ltd. | pass | 24.2 | 1224 | C | 5.79 | 0.54 | 3.2% | G2 avoid |
| 321 | 5603 | KOGI CORPORATION | pass | 24.2 | 1225 | D | 4.34 | 0.22 | 3.9% | G2 avoid |
| 322 | 8869 | Meiwa Estate Company Limited | pass | 24.1 | 1226 | C | 18.76 | 0.50 | 5.6% | G2 avoid |
| 323 | 8931 | WADAKOHSAN CORPORATION | pass | 24.0 | 1228 | C | 14.63 | 0.42 | 5.5% | G2 avoid |
| 324 | 7808 | C.S. LUMBER CO.,INC | pass | 24.0 | 1227 | C | 4.86 | 0.41 | 3.0% | G2 avoid |
| 325 | 3417 | OHKI HEALTHCARE HOLDINGS CO.,LTD. | pass | 23.8 | 1231 | D | 14.02 | 0.42 | 3.0% | G2 avoid |
| 326 | 5921 | Kawagishi Bridge Works Co.,Ltd. | pass | 22.3 | 1236 | A | 13.08 | 0.44 | 3.7% | G2 avoid |
| 327 | 3765 | GungHo Online Entertainment,Inc. | pass | 21.9 | 1241 | C | 130.35 | 0.89 | 3.7% | G2 avoid |
| 328 | 7975 | LIHIT LAB.,INC. | pass | 21.7 | 1242 | D | 4.5 | 0.41 | 2.1% | G2 avoid |
| 329 | 7256 | KASAI KOGYO CO.,LTD. | pass | 20.7 | 1244 | C | 22.25 | 0.72 | 0.0% | G2 avoid |
| 330 | 4539 | NIPPON CHEMIPHAR CO.,LTD. | pass | 17.1 | 1254 | C | 6.66 | 0.34 | 3.2% | G2 avoid |
| 331 | 7896 | SEVEN INDUSTRIES CO.,LTD. | pass | 15.1 | 1257 | D | 2.36 | 0.39 | 4.0% | G2 avoid |

Sources: J-Quants (prices, 決算短信 earnings summaries, listed-issue master data) and FMP quarterly balance sheets, both via the session proxy. Engine run `reports/evaluate/2026-09-29_033952` in the engine clone.
