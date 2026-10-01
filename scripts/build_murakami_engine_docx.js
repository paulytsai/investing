const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, HeadingLevel,
  LevelFormat, BorderStyle, Footer, PageNumber, TableLayoutType, PageBreak, PageOrientation } = require('docx');
const S = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const st = S.stats;
const FONT = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Yu Gothic', cs: 'Arial' };
const NAVY = '1F3864', ALT = 'F2F5FA', LINE = 'BFC7D5', W = 9360, WL = 13680;
const r = (text, o = {}) => new TextRun({ text: String(text), font: FONT, size: o.size || 20, bold: o.bold, italics: o.italics, color: o.color });
const p = (runs, o = {}) => new Paragraph({ spacing: { after: o.after ?? 120, before: o.before ?? 0 }, children: Array.isArray(runs) ? runs : [r(runs, o)] });
const h1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 120 }, children: [new TextRun({ text: t, font: FONT, size: 30, bold: true, color: NAVY })] });
const h2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 80 }, keepNext: true, children: [new TextRun({ text: t, font: FONT, size: 24, bold: true, color: '2E5597' })] });
const bullet = runs => new Paragraph({ numbering: { reference: 'bul', level: 0 }, spacing: { after: 60 }, children: Array.isArray(runs) ? runs : [r(runs)] });
const B = (b, t) => bullet([r(b, { bold: true }), r(t)]);
function table(headers, rows, rel, align = [], size = 16, width = W) {
  const tot = rel.reduce((a, b) => a + b, 0); const w = rel.map(x => Math.floor(x / tot * width)); w[w.length - 1] += width - w.reduce((a, b) => a + b, 0);
  const b = { style: BorderStyle.SINGLE, size: 4, color: LINE }; const borders = { top: b, bottom: b, left: b, right: b };
  const cell = (t, i, head, k) => new TableCell({ width: { size: w[i], type: WidthType.DXA }, borders, shading: { type: ShadingType.CLEAR, color: 'auto', fill: head ? NAVY : (k % 2 ? ALT : 'FFFFFF') },
    margins: { top: 30, bottom: 30, left: 60, right: 60 }, children: [new Paragraph({ alignment: !head && align[i] === 'r' ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [r(t, { size, bold: head, color: head ? 'FFFFFF' : undefined })] })] });
  const out = [new TableRow({ tableHeader: true, children: headers.map((x, i) => cell(x, i, true, 0)) })];
  rows.forEach((row, k) => out.push(new TableRow({ cantSplit: true, children: row.map((x, i) => cell(x ?? '', i, false, k)) })));
  return new Table({ width: { size: width, type: WidthType.DXA }, columnWidths: w, layout: TableLayoutType.FIXED, rows: out });
}

const UNI = { mura: '948 companies', cash: '1,257 companies' };
const GLOSS = {
  'Investor': 'Which Murakami-linked group holds the stake. Murakami family = City Index Eleventh, Aya Nomura and the related family companies. Takateru (MI) = Takateru Murakami and his companies MI1, MI2 and MI5. Strategic Capital = the fund founded by ex-Murakami Fund manager Tsuyoshi Maruki.',
  'Code': 'Tokyo Stock Exchange securities code.',
  'New in 2026': 'Yes if the investor\'s first large-shareholding report (crossing 5%) was triggered on or after 2026-01-01; No for positions started earlier and still held at 5% or more.',
  'Cash ÷ value': 'Cash and short-term investments ÷ market value, from the latest quarterly balance sheet (FMP; J-Quants for Primo). Debt not subtracted.',
  'Net cash + securities ÷ value': 'Cash and short-term investments plus long-term investment securities (largely cross-shareholdings) minus all debt, ÷ market value. The broadest measure of cash-like assets net of borrowing.',
  'Cash verdict': 'Cash-rich (tier A–D) = passes one of the four 100% tests used for the 331 list. Cash-heavy = net cash + securities between 30% and 100% of market value. Not cash-rich = below 30%.',
  'Note': 'Why a cash verdict may overstate the cash a shareholder could get back.',
  'Company': 'Company name.',
  'First 5% filing': 'Date the investor first crossed 5%: the trigger date of its first large-shareholding report (大量保有報告書).',
  'Stake': 'Percentage of the company\'s shares held by the investor and its joint holders, per its latest filing.',
  'Trend': 'Direction of the latest filing. Adding = the latest change report raised the stake. Trimming = it lowered the stake. Initial filing only = no change report since crossing 5%. Cut below 5% = the latest stake is under 5%, so further sales no longer have to be reported.',
  'Idea Strength': 'The engine\'s overall score, 0–100. It is a weighted average of eight sub-scores: story & growth 20%, moat 15%, quality & cash 15%, on sale vs fair value 15%, asymmetry 10%, management alignment 10%, fundamental momentum 10%, portfolio fit 5%. Each sub-score is itself a percentile rank within the run\'s universe, so 50 is about average. Penalties are then subtracted, for example for a big 12-month run-up or a cyclical company at peak margins.',
  'Percentile': 'Where the company\'s Idea Strength ranks in the run\'s universe: 100 × (1 − (rank − 1) ÷ number of companies). 100 is the top; 74 means it scores higher than about 74% of the companies; 3 means near the bottom. This is a rank against other companies, not a return or a probability.',
  'Engine status': 'The engine\'s action. Buy in stages = Idea Strength ≥ 70, on-sale sub-score ≥ 50, and every gate passed. Watch = Idea Strength ≥ 55 and every gate passed. Pass = no buy or watch call, either because the score is too low or because a gate held it back (see Blocked by). Excluded = removed by a hard rule. Insufficient data = too few metrics to score.',
  'Blocked by': 'The rule that made the company ineligible; Section 2 explains each in full. G2 value trap = trades below 1× book with no catalyst (insider buying, or dividends plus buybacks of 2% or more a year); for Japan the engine lacks that data, so this mostly means not tested. X-01/X-02 no revenue = excluded as pre-revenue or a loss-making "dream stock"; in these runs it fired only because the engine had no data for the company. X-22/R-15 peak margins = a cyclical company whose operating margin is at the top of its own history. "none" = passed every gate.',
  'P/B': 'Price to book: market value ÷ book equity from the latest report. Below 1 means the market values the company at less than its accounting net assets.',
  'Tier': 'Strictest cash test the company passes. A (NCAV) = current assets minus all liabilities ≥ market value. B (net cash) = cash and short-term investments minus debt ≥ market value. C (gross cash) = cash and short-term investments ≥ market value, debt not subtracted. D (working capital) = current assets minus current liabilities ≥ market value.',
  'Mkt cap ¥B': 'Market value in ¥ billions at the 2026-09-29 close: price × shares outstanding excluding treasury shares.',
  '¥M/day': 'Median daily trading value over the last three months, in ¥ millions. It indicates how quickly an investor could build a 5% stake.',
  'Largest strategic holder': 'Largest holder on the Kabutan top-10 list after excluding trust banks, custodians, brokers, treasury shares and employee or supplier share clubs, with its percentage of shares.',
  'Controlling / largest holder': 'Largest strategic holder (same definition as above). At 30% or more it can block a campaign or a vote on its own.',
  'Fit': 'My Murakami-fit score, 0–10, for resemblance to the 2026 Murakami entries. Market value ¥5–300B: 2 points. P/B below 0.7: 2 (below 1: 1). Tier A or B: 2. Profitable: 1. Median trading ≥ ¥50M a day: 2 (≥ ¥20M: 1). Payout ratio under 35%: 1. Minus 3 if the cash is customer float or property inventory. Not an engine score.',
  'Div. yield': 'Forecast dividend per share (latest actual if no forecast) ÷ price, from J-Quants. 2% or more would satisfy G2\'s shareholder-yield test if the engine had the data.',
  'Held by': 'Murakami-linked investor already holding the stock, with its stake per the latest filing.',
  'Chosen': 'Whether the engine\'s sourcing step (its top-20 idea list, with a per-sector limit) would pick the company.',
};
GLOSS['Idea Str.'] = GLOSS['Idea Strength']; GLOSS['Engine'] = GLOSS['Engine status'];
function legend(headers, uni) {
  const out = [new Paragraph({ spacing: { before: 80, after: 40 }, keepNext: true, children: [r('Columns', { size: 16, bold: true, color: '2E5597' })] })];
  for (const h of headers) {
    let d = GLOSS[h]; if (!d) continue;
    if ((h === 'Percentile') && uni) d += ` Universe for this table: ${uni}, i.e. the engine's Japan universe (Prime and Standard companies worth ¥100B or more on 2026-09-29) plus the names being evaluated.`;
    out.push(new Paragraph({ spacing: { after: 30 }, indent: { left: 200 }, children: [r(h + ': ', { size: 15, bold: true }), r(d, { size: 15 })] }));
  }
  return out;
}

const K = [];
K.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Murakami New Positions and Japan Cash-Rich Stocks', font: FONT, size: 38, bold: true, color: NAVY })] }));
K.push(new Paragraph({ spacing: { after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 4 } },
  children: [r('Results from the Paul Tsai investment engine  ·  prices as of 2026-09-29, large-holding filings through 2026-10-01', { size: 19, color: '555555' })] }));
K.push(h1('Summary'));
K.push(B('Murakami-linked investors started 17 new 5% stakes in 2026. ', 'No new filings appeared on Sept 30 or Oct 1. The Murakami family opened 9, mostly a paper and packaging cluster: Rengo, Japan Pulp & Paper, Nippon Paper, KPP and Mitsubishi Paper, plus Air Water, Yamada, Sankei Real Estate and Nippon Chemical, which has since been cut below 5%. Takateru Murakami opened 5, and Strategic Capital, founded by an ex-Murakami Fund manager, opened 3.'));
K.push(B('The engine is lukewarm on these new stakes. ', 'Only TOW, one of Takateru\'s, reaches Watch (74th percentile). Most of the family\'s new positions sit in the bottom decile: Yamada and Rengo at the 3rd percentile, Air Water at the 7th. The engine scores earnings momentum, quality and growth. A Murakami position is a bet on a catalyst: buybacks, unwinding cross-shareholdings, or a sale of the company. The engine does not score catalysts.'));
K.push(B('Few of the new Murakami stakes are cash-rich. ', 'Only Nippon Paper and AD Works pass a cash test, and both are hollow: debt or property inventory sits behind the cash. TOW, Metal Art and Nippn are cash-heavy; the other 12 are not cash-rich. TOW, the engine\'s best-rated new pick, holds cash equal to 45% of its market value, short of the 100% bar, so it was never on the 331 list (Section 4).'));
K.push(B(`${st.ncand} companies from the cash-rich list look like plausible next targets. `, 'They are below book value, profitable, liquid enough to build a 5% stake, and have no shareholder above 30%. At the top are Hi-Lex, Kato Works, Nakayama Steel, Futaba, Shima Seiki, Mitsuba and Shindengen. Another seven high scorers are blocked by a controlling shareholder.'));
K.push(B(`${st.nheld} of the ${st.n} cash-rich companies already have a Murakami-linked holder. `, 'Nippon Paper and Shinko Shoji (the family), AD Works (Takateru), Kinki Sharyo and Naigai (Effissimo), GungHo and Kyokuto Boeki (Strategic Capital).'));
K.push(B('Treat the engine\'s Japan verdicts with care. ', `Two of its rules misfire on Japanese data. The value-trap gate (G2) blocked ${st.g2} of the ${st.n} names because the engine cannot see Japanese buybacks or insider buying; ${st.g2y} of those ${st.g2} actually pay a dividend of 2% or more. The no-revenue rule (X-01/X-02) blocked ${st.x01} names only because the engine never downloaded their data. Section 2 explains each rule.`));

K.push(h1('1. How to read the tables'));
K.push(p('Every table is followed by a Columns key that defines each column. The terms used most often:', { size: 18 }));
K.push(B('Idea Strength (0–100). ', 'The engine\'s overall score: a weighted average of eight sub-scores (story & growth, moat, quality & cash, on sale vs fair value, asymmetry, management alignment, fundamental momentum, portfolio fit), each ranked against the other companies in the run, minus penalties.'));
K.push(B('Percentile. ', 'A rank, not a return or a probability. It shows how the company\'s Idea Strength compares with every other company in the same run: 100 × (1 − (rank − 1) ÷ number of companies). TOW at the 74th percentile scores higher than about 74% of the 948 companies in that run; Yamada at the 3rd percentile is near the bottom. Each run\'s universe is the engine\'s Japan universe (Prime and Standard companies worth ¥100B or more on 2026-09-29) plus the names being evaluated: 948 companies for the Murakami positions, 1,257 for the cash-rich list.'));
K.push(B('Engine status. ', 'Buy in stages and Watch are the engine\'s positive calls. Pass means the company cleared the hard exclusions but isn\'t a call. Excluded means a hard rule removed it: X-01/X-02 for a loss-maker, X-22/R-15 for a cyclical at peak margins.'));
K.push(B('Blocked by. ', 'The gate or rule that made a company ineligible. Section 2 explains each one.'));
K.push(B('Cash-rich tiers. ', 'A: current assets minus all liabilities (NCAV) at least market value. B: net cash at least market value. C: gross cash at least market value. D: working capital at least market value. A and B are the cleanest asset plays.'));
K.push(B('Murakami fit (0–10). ', 'My score for resemblance to the 2026 Murakami entries: market value ¥5–300B (2 points), P/B below 0.7 (2) or below 1 (1), tier A or B (2), profitable (1), median daily trading ≥¥50M (2) or ≥¥20M (1), payout ratio under 35% (1). It subtracts 3 for payment float or property inventory. The register check uses the Kabutan top-10 shareholder list.'));


K.push(h1('2. The rules that block a company'));
K.push(p('The engine scores every company, then applies hard exclusions and gates. A company that fails one is ineligible: it keeps its Idea Strength and percentile, but cannot be a Buy in stages or Watch call. Only three rules blocked companies in these runs.', { size: 18 }));
K.push(h2('G2 value trap (engine rule F-22/X-18)'));
K.push(B('What it tests. ', 'Whether a stock trading below 1× book (P/B under 1) has a catalyst. It passes only if officers bought shares on the open market in the last 12 months, or dividends plus buybacks over the last year equal at least 2% of market value. Otherwise the outcome is "avoid".'));
K.push(B('Why it exists. ', 'Your spec calls a P/B below 1 without a catalyst a value trap (価値の罠): cheap assets that stay cheap because owners and management have no reason to return them. The philosophy file adds that Japanese names need a specific story.'));
K.push(B('How often it fired. ', `${st.g2} of the ${st.n} cash-rich stocks (plus ${st.x22} that also hit X-22/R-15), and 9 of the 17 Murakami stakes (including Metal Art, which also hit X-22/R-15).`));
K.push(B('Why most of these blocks are not real. ', `For Japan the engine has dividends per share but not total dividends paid or buybacks, and there is no Japanese equivalent of US insider-trading filings. Shareholder yield therefore comes out as 0% and the gate fails automatically. Using J-Quants dividend per share against price, ${st.g2y} of the ${st.g2} blocked cash-rich names yield 2% or more from dividends alone and would pass. Read a G2 block on a Japanese company as "not tested", not as "value trap".`));
K.push(h2('X-01/X-02 no revenue (pre-revenue or loss-making "dream stock")'));
K.push(B('What it tests. ', 'Excludes a company whose trailing 12-month revenue is missing or below the engine\'s floor (set as US$100 million), or that is loss-making while priced above 15× sales.'));
K.push(B('Why it exists. ', 'Your spec treats pre-revenue or loss-making "dream" stocks as speculative positions, never core holdings.'));
K.push(B('How often it fired. ', `${st.x01} cash-rich stocks, plus Sankei Real Estate among the Murakami stakes.`));
K.push(B('Why these blocks are not real. ', `Every one fired because the engine had no data for the company, not because of its numbers. The engine downloads only Prime and Standard companies, so the ${st.x01_growth} Growth-market names and the Sankei REIT have no prices or financials. The other 3 (Nepon, Kawase Computer Supplies, Yamazaki) are filed under old market-segment names and were not downloaded either. All ${st.x01} have revenue of ¥1.6–50B, and ${st.x01_profit} are profitable.`));
K.push(h2('X-22/R-15 peak margins (cyclical at peak margins)'));
K.push(B('What it tests. ', 'For companies the engine classifies as commodity cyclicals or resource producers, it excludes those whose operating margin is at or above the 90th percentile of their own history.'));
K.push(B('Why it exists. ', 'At peak margins a cyclical company\'s earnings are flattered, so a low P/E is a trap: the earnings usually fall back.'));
K.push(B('How often it fired. ', `${st.x22} cash-rich stocks (all of which also failed G2), plus Metal Art among Takateru\'s stakes. This rule reflects real data and is a genuine judgment.`));
K.push(p('Other gates (G1 management alignment, G3 balance sheet, G4 speculation, and the remaining exclusions such as funds, banks and recent listings) were checked but did not block any company here. G3 can cap a position size without blocking it.', { size: 18, before: 60 }));

K.push(new Paragraph({ children: [new PageBreak()] }));
K.push(h1('3. New Murakami-linked stakes in 2026, through the engine'));
K.push(p('Each row is a stake first reported at 5% or more in 2026, with the latest stake and direction from the filings. Engine scores are as of 2026-09-29, in a universe of 948.', { size: 18 }));
K.push(table(['Investor', 'Code', 'Company', 'First 5% filing', 'Stake', 'Trend', 'Idea Strength', 'Percentile', 'Engine status', 'Blocked by', 'P/B'], S.mura,
  [11, 5, 17, 9, 6, 9, 7, 6, 8, 11, 5], ['', '', '', '', 'r', '', 'r', 'r', '', '', 'r'], 14));
legend(['Investor', 'Code', 'Company', 'First 5% filing', 'Stake', 'Trend', 'Idea Strength', 'Percentile', 'Engine status', 'Blocked by', 'P/B'], UNI.mura).forEach(x => K.push(x));
K.push(h2('What stands out'));
K.push(B('The paper cluster. ', 'The family holds Nippon Paper (9.8%), Rengo (6.1%), Mitsubishi Paper (6.1%), Japan Pulp & Paper (5.1%) and KPP (5.0%). That looks like a bet on industry consolidation. The engine scores them weakly (3rd–50th percentile). Nippon Paper is the strongest at the 50th percentile, at 0.28× book, but G2 blocks it.'));
K.push(B('Takateru\'s stakes score better than his father\'s. ', 'Primo (69th percentile), DaikyoNishikawa and AD Works (both 63rd), and TOW (74th, Watch). That fits his move toward better businesses at a discount. The engine excludes Metal Art as a cyclical at peak margins.'));
K.push(B('Sankei Real Estate (29.9%) ', 'scores 59 but is excluded under X-01/X-02. That is a data gap, not a judgment: it is a REIT, REITs trade on a separate market the engine does not download, so it has no revenue data (Section 2).'));


K.push(new Paragraph({ children: [new PageBreak()] }));
K.push(h1('4. Every Murakami-linked pick: new position, and is it cash-rich?'));
K.push(p(`All ${st.npicks} positions the four Murakami-linked groups hold at 5% or more, plus 2026 entries since cut, rated on two questions: did they start it in 2026, and does the company pass the cash tests used for the 331 list? Engine scores are from one run of all the picks together, in a universe of 956 companies.`, { size: 18 }));
K.push(B('Why TOW was not on the cash-rich list. ', 'TOW\'s cash is 45% of its market value, net cash 42% and NCAV 44%, so it fails all four 100% tests. My pre-filter had also skipped it (P/B 1.78), but the full test gives the same answer. It was left off the target list in any case because Takateru already owns 7.47%. TOW is cash-heavy, not cash-rich, and it is the engine\'s best-rated new Murakami pick: Watch, 74th percentile, no rule blocking it. G2 does not apply because it trades above book.'));
K.push(B('Most 2026 entries are not cash plays. ', `Of the 17 stakes started in 2026, only two pass a cash test, and both are hollow: Nippon Paper on gross cash alone (its debt is 6× its market value) and AD Works on working capital that is mostly property inventory. Three are cash-heavy (TOW, Metal Art and Nippn). The other 12 are not cash-rich, including Sankei Real Estate, whose "investments" are its buildings. The family\'s 2026 thesis is leveraged, low-P/B paper and industrial companies, consolidation and cross-shareholdings, not idle cash.`));
K.push(B('The older book is more cash-heavy. ', 'Of the positions started before 2026, three pass a cash test (Kinki Sharyo, Naigai and GungHo) and 11 are cash-heavy, mostly Effissimo holdings. The engine\'s only positive calls among all picks are TOW, Fujibo and Kanto Denka (Watch); none of them is cash-rich.'));
K.push(table(['Investor', 'Code', 'Company', 'First 5% filing', 'New in 2026', 'Stake', 'Cash ÷ value', 'Net cash + securities ÷ value', 'Cash verdict', 'Note', 'Idea Strength', 'Percentile', 'Engine status', 'Blocked by'], S.picks,
  [9, 4, 13, 7, 4, 5, 5, 6, 8, 13, 5, 5, 6, 10], ['', '', '', '', '', 'r', 'r', 'r', '', '', 'r', 'r', '', ''], 13));
legend(['Investor', 'Code', 'Company', 'First 5% filing', 'New in 2026', 'Stake', 'Cash ÷ value', 'Net cash + securities ÷ value', 'Cash verdict', 'Note', 'Idea Strength', 'Percentile', 'Engine status', 'Blocked by'], '956 companies').forEach(x => K.push(x));

K.push(new Paragraph({ children: [new PageBreak()] }));
K.push(h1('5. Likely next targets among the cash-rich stocks'));
K.push(p(`These are the cash-rich names with fit 8 or more, P/B below 1, median trading of ¥20M a day or more, no Murakami-linked holder yet, and no strategic holder at 30% or more. Sorted by fit, then Idea Strength.`, { size: 18 }));
K.push(table(['Code', 'Company', 'Tier', 'Mkt cap ¥B', 'P/B', '¥M/day', 'Largest strategic holder', 'Fit', 'Idea Str.', 'Percentile', 'Engine', 'Div. yield'], S.cand,
  [5, 15, 9, 6, 5, 6, 17, 4, 6, 5, 7, 6], ['', '', '', 'r', 'r', 'r', '', 'r', 'r', 'r', '', 'r'], 14));
legend(['Code', 'Company', 'Tier', 'Mkt cap ¥B', 'P/B', '¥M/day', 'Largest strategic holder', 'Fit', 'Idea Str.', 'Percentile', 'Engine', 'Div. yield'], UNI.cash).forEach(x => K.push(x));
K.push(h2('Notes on the leading names'));
K.push(B('Nakayama Steel Works (5408). ', 'Tier A at 0.35× book. Air Water owns 7.5% of it, and the Murakami family started a 6.9% stake in Air Water in May. Getting Air Water to sell its cross-holdings would put this stake in play. Hanwa holds 12.8%.'));
K.push(B('Hi-Lex (7279). ', 'An auto cable maker at 0.39× book with ¥183M a day of trading. The founder family holds about 32% (Teraura Kosan 27.7% plus a foundation 4.1%), so the stake can be contested but not won outright. This matches Takateru\'s auto-parts pattern (DaikyoNishikawa, TOW, Metal Art).'));
K.push(B('Futaba (6986) and Shima Seiki (6222). ', 'Both are at 0.33–0.38× book with net cash and an open register. Futaba was the top LENS target in the earlier screen.'));
K.push(B('Mitsuba (7280) and Shindengen (6844). ', 'Honda-group suppliers at 0.43–0.45× book. Honda owns 11.5% of Shindengen and 3.6% of Mitsuba. Supplier groups reorganizing around a carmaker is the setup Takateru played in Ashimori (Toyoda Gosei) and DaikyoNishikawa.'));
K.push(B('Kato Works (6390). ', 'A crane maker at 0.36× book with a 5.5% dividend yield, low payout and no large holder.'));
K.push(B('Other activists already present. ', 'Ichigo Trust holds 4.3% of Ohashi Technica.'));
K.push(h2('High scorers blocked by a controlling shareholder'));
K.push(table(['Code', 'Company', 'Controlling / largest holder', 'Fit', 'Idea Str.', 'Engine'], S.blocked, [6, 22, 30, 5, 7, 10], ['', '', '', 'r', 'r', ''], 16));
legend(['Code', 'Company', 'Controlling / largest holder', 'Fit', 'Idea Str.', 'Engine'], null).forEach(x => K.push(x));
K.push(h2('Cash-rich names already held by Murakami-linked investors'));
K.push(table(['Code', 'Company', 'Held by', 'Tier', 'P/B', 'Idea Str.', 'Percentile', 'Engine', 'Blocked by'], S.held, [5, 18, 22, 11, 5, 7, 6, 8, 10], ['', '', '', '', 'r', 'r', 'r', '', ''], 15));
legend(['Code', 'Company', 'Held by', 'Tier', 'P/B', 'Idea Str.', 'Percentile', 'Engine', 'Blocked by'], UNI.cash).forEach(x => K.push(x));

K.push(new Paragraph({ children: [new PageBreak()] }));
K.push(h1(`6. Engine results for all ${st.n} cash-rich stocks`));
K.push(p(`Tiers: A ${st.tiers.A}, B ${st.tiers.B}, C ${st.tiers.C}, D ${st.tiers.D}. The engine ranked them in a universe of 1,257 Japanese names. Buy in stages: ${st.bis}. Watch: ${st.watch}. Eligible: ${st.elig}. Chosen by the sourcing top-20: ${st.chosen}. Blocked: G2 ${st.g2}, X-01/X-02 ${st.x01}, X-22/R-15 plus G2 ${st.x22}.`, { size: 18 }));
K.push(h2('Eligible names (passed every gate)'));
K.push(table(['Code', 'Company', 'Tier', 'Idea Strength', 'Percentile', 'Engine status', 'Chosen'], S.eligible, [6, 30, 14, 10, 8, 12, 8], ['', '', '', 'r', 'r', '', ''], 16));
legend(['Code', 'Company', 'Tier', 'Idea Strength', 'Percentile', 'Engine status', 'Chosen'], UNI.cash).forEach(x => K.push(x));
K.push(p('CHIeru (3933) is the only name the sourcing step would pick. Chiyoda\'s net cash is largely customer advances, which is typical for an engineering contractor, so it isn\'t a true asset play.', { before: 80, size: 18 }));
K.push(h2('Top 25 by Idea Strength'));
K.push(table(['Code', 'Company', 'Tier', 'Mkt cap ¥B', 'P/B', 'Div. yield', 'Idea Str.', 'Percentile', 'Engine', 'Blocked by'], S.engine_top, [5, 22, 11, 7, 5, 6, 6, 5, 8, 12], ['', '', '', 'r', 'r', 'r', 'r', 'r', '', ''], 15));
legend(['Code', 'Company', 'Tier', 'Mkt cap ¥B', 'P/B', 'Div. yield', 'Idea Str.', 'Percentile', 'Engine', 'Blocked by'], UNI.cash).forEach(x => K.push(x));

K.push(h1('7. Data gaps and caveats'));
K.push(B('X-01/X-02 fired only on missing data. ', `The engine downloads Prime and Standard companies only, so Growth-market names, REITs and companies still filed under old segment names have no data and are excluded as no revenue (${st.x01} cash-rich names plus Sankei Real Estate).`));
K.push(B('The value-trap gate (G2) is mostly a data artifact for Japan. ', `G2 lets a stock below book pass only with insider buying or a shareholder yield of at least 2%. For Japan the engine has dividends per share but not dividends paid or buybacks, and there is no Japanese equivalent of US insider-trading filings. So shareholder yield is always 0%. ${st.g2y} of the ${st.g2} G2-blocked names yield 2% or more on J-Quants dividend per share.`));
K.push(B('Every Japanese name is filed under the sector "Other". ', 'The engine doesn\'t map the Tokyo Stock Exchange\'s 17 sector groups, so it makes no sector calls for Japan. The macro panel is US-only, and written narratives were off because there is no Anthropic API key.'));
K.push(B('The two runs used slightly different universes. ', 'The 331-name run ranked against 1,257 names and the Murakami run against 948. Both share the same base of Japanese companies worth ¥100B or more, so the percentiles are comparable but not identical.'));
K.push(B('The fit score is mine, not the engine\'s. ', 'It describes resemblance to past entries, not a forecast. Ownership comes from top-10 lists only; stakes under 5% are not disclosed. Exit decisions are not shown.'));
K.push(B('Local changes to the engine (not committed). ', 'J-Quants coverage now starts 2016-10-01, so JQ_START in src/engine/pit/pull_jp.py was moved from 2016-09-30. The Japan build was rerun with a 16 GB swap file after running out of memory.'));
K.push(h1('Sources'));
K.push(p('Large-holding reports (大量保有報告書 / 変更報告書) from EDINET via ufocatch.com, through 2026-10-01. Prices, earnings summaries and dividends per share from J-Quants (JPX). Quarterly balance sheets from Financial Modeling Prep. Top-10 shareholders from Kabutan. Engine runs reports/evaluate/2026-09-29_033952 and 2026-09-29_061643 on branch claude/investment-philosophy-summary-218q6y.', { size: 18 }));

const A = [];
A.push(h1(`Appendix: all ${st.n} cash-rich stocks, by Idea Strength`));
legend(['Code', 'Company', 'Tier', 'Mkt cap ¥B', 'P/B', 'Div. yield', 'Idea Str.', 'Percentile', 'Engine', 'Blocked by', 'Fit'], UNI.cash).forEach(x => A.push(x));
A.push(table(['Code', 'Company', 'Tier', 'Mkt cap ¥B', 'P/B', 'Div. yield', 'Idea Str.', 'Percentile', 'Engine', 'Blocked by', 'Fit'], S.all, [5, 26, 4, 7, 5, 6, 6, 5, 8, 13, 4], ['', '', '', 'r', 'r', 'r', 'r', 'r', '', '', 'r'], 14, WL));

const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [r('Murakami positions + cash-rich screen · page ', { size: 16, color: '888888' }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '888888' })] })] });
const doc = new Document({ creator: 'investing research', title: 'Murakami New Positions and Japan Cash-Rich Stocks',
  styles: { default: { document: { run: { font: 'Arial', size: 20 } } }, paragraphStyles: [
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true, font: 'Arial' }, paragraph: { outlineLevel: 0 } },
    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, font: 'Arial' }, paragraph: { outlineLevel: 1 } }] },
  numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
  sections: [
    { properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1300, bottom: 1300, left: 1440, right: 1440 } } }, footers: { default: footer }, children: K },
    { properties: { page: { size: { width: 12240, height: 15840, orientation: PageOrientation.LANDSCAPE }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, footers: { default: footer }, children: A }] });
Packer.toBuffer(doc).then(b => { fs.writeFileSync(process.argv[3], b); console.log('wrote', process.argv[3], b.length); });
