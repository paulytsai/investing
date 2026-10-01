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
const K = [];
K.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Murakami New Positions and Japan Cash-Rich Stocks', font: FONT, size: 38, bold: true, color: NAVY })] }));
K.push(new Paragraph({ spacing: { after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 4 } },
  children: [r('Results from the Paul Tsai investment engine  ·  prices as of 2026-09-29, large-holding filings through 2026-10-01', { size: 19, color: '555555' })] }));
K.push(h1('Summary'));
K.push(B('Murakami-linked investors started 17 new 5% stakes in 2026. ', 'No new filings appeared on Sept 30 or Oct 1. The Murakami family opened 9, mostly a paper and packaging cluster: Rengo, Japan Pulp & Paper, Nippon Paper, KPP and Mitsubishi Paper, plus Air Water, Yamada, Sankei Real Estate and Nippon Chemical, which has since been cut below 5%. Takateru Murakami opened 5, and Strategic Capital, founded by an ex-Murakami Fund manager, opened 3.'));
K.push(B('The engine is lukewarm on these new stakes. ', 'Only TOW, one of Takateru\'s, reaches Watch (74th percentile). Most of the family\'s new positions sit in the bottom decile: Yamada and Rengo at the 3rd percentile, Air Water at the 7th. The engine scores earnings momentum, quality and growth. A Murakami position is a bet on a catalyst: buybacks, unwinding cross-shareholdings, or a sale of the company. The engine does not score catalysts.'));
K.push(B(`${st.ncand} companies from the cash-rich list look like plausible next targets. `, 'They are below book value, profitable, liquid enough to build a 5% stake, and have no shareholder above 30%. At the top are Hi-Lex, Kato Works, Nakayama Steel, Futaba, Shima Seiki, Mitsuba and Shindengen. Another seven high scorers are blocked by a controlling shareholder.'));
K.push(B(`${st.nheld} of the ${st.n} cash-rich companies already have a Murakami-linked holder. `, 'Nippon Paper and Shinko Shoji (the family), AD Works (Takateru), Kinki Sharyo and Naigai (Effissimo), GungHo and Kyokuto Boeki (Strategic Capital).'));
K.push(B('Treat the engine\'s Japan verdicts with care. ', `Its value-trap gate (G2) blocked ${st.g2} of the ${st.n} names. That gate needs insider buying or a shareholder yield of 2% or more, and the engine has neither for Japan. ${st.g2y} of those ${st.g2} actually pay a dividend of 2% or more. Section 5 explains this.`));

K.push(h1('1. How to read the tables'));
K.push(B('Idea Strength (0–100) and percentile. ', 'This is the engine\'s overall score. The percentile ranks each company against a universe of Japanese companies worth ¥100B or more, plus the names being evaluated.'));
K.push(B('Engine status. ', 'Buy in stages and Watch are the engine\'s positive calls. Pass means the company cleared the hard exclusions but isn\'t a call. Excluded means a hard rule removed it: X-01/X-02 for a loss-maker, X-22/R-15 for a cyclical at peak margins.'));
K.push(B('Blocked by. ', 'The gate or rule that made a company ineligible. G2 avoid is the value-trap gate: below 1× book with no catalyst.'));
K.push(B('Cash-rich tiers. ', 'A: current assets minus all liabilities (NCAV) at least market value. B: net cash at least market value. C: gross cash at least market value. D: working capital at least market value. A and B are the cleanest asset plays.'));
K.push(B('Murakami fit (0–10). ', 'My score for resemblance to the 2026 Murakami entries: market value ¥5–300B (2 points), P/B below 0.7 (2) or below 1 (1), tier A or B (2), profitable (1), median daily trading ≥¥50M (2) or ≥¥20M (1), payout ratio under 35% (1). It subtracts 3 for payment float or property inventory. The register check uses the Kabutan top-10 shareholder list.'));

K.push(new Paragraph({ children: [new PageBreak()] }));
K.push(h1('2. New Murakami-linked stakes in 2026, through the engine'));
K.push(p('Each row is a stake first reported at 5% or more in 2026, with the latest stake and direction from the filings. Engine scores are as of 2026-09-29, in a universe of 948.', { size: 18 }));
K.push(table(['Investor', 'Code', 'Company', 'First 5% filing', 'Stake', 'Trend', 'Idea Strength', 'Pctile', 'Engine status', 'Blocked by', 'P/B'], S.mura,
  [11, 5, 17, 9, 6, 9, 7, 6, 8, 11, 5], ['', '', '', '', 'r', '', 'r', 'r', '', '', 'r'], 14));
K.push(h2('What stands out'));
K.push(B('The paper cluster. ', 'The family holds Nippon Paper (9.8%), Rengo (6.1%), Mitsubishi Paper (6.1%), Japan Pulp & Paper (5.1%) and KPP (5.0%). That looks like a bet on industry consolidation. The engine scores them weakly (3rd–50th percentile). Nippon Paper is the strongest at the 50th percentile, at 0.28× book, but G2 blocks it.'));
K.push(B('Takateru\'s stakes score better than his father\'s. ', 'Primo (69th percentile), DaikyoNishikawa and AD Works (both 63rd), and TOW (74th, Watch). That fits his move toward better businesses at a discount. The engine excludes Metal Art as a cyclical at peak margins.'));
K.push(B('Sankei Real Estate (29.9%) ', 'scores 59 but is excluded under X-01/X-02. It is a REIT, so the engine\'s operating-company tests don\'t fit it.'));

K.push(new Paragraph({ children: [new PageBreak()] }));
K.push(h1('3. Likely next targets among the cash-rich stocks'));
K.push(p(`These are the cash-rich names with fit 8 or more, P/B below 1, median trading of ¥20M a day or more, no Murakami-linked holder yet, and no strategic holder at 30% or more. Sorted by fit, then Idea Strength.`, { size: 18 }));
K.push(table(['Code', 'Company', 'Tier', 'Mkt cap ¥B', 'P/B', '¥M/day', 'Largest strategic holder', 'Fit', 'Idea Str.', 'Pctile', 'Engine', 'Div. yield'], S.cand,
  [5, 15, 9, 6, 5, 6, 17, 4, 6, 5, 7, 6], ['', '', '', 'r', 'r', 'r', '', 'r', 'r', 'r', '', 'r'], 14));
K.push(h2('Notes on the leading names'));
K.push(B('Nakayama Steel Works (5408). ', 'Tier A at 0.35× book. Air Water owns 7.5% of it, and the Murakami family started a 6.9% stake in Air Water in May. Getting Air Water to sell its cross-holdings would put this stake in play. Hanwa holds 12.8%.'));
K.push(B('Hi-Lex (7279). ', 'An auto cable maker at 0.39× book with ¥183M a day of trading. The founder family holds about 32% (Teraura Kosan 27.7% plus a foundation 4.1%), so the stake can be contested but not won outright. This matches Takateru\'s auto-parts pattern (DaikyoNishikawa, TOW, Metal Art).'));
K.push(B('Futaba (6986) and Shima Seiki (6222). ', 'Both are at 0.33–0.38× book with net cash and an open register. Futaba was the top LENS target in the earlier screen.'));
K.push(B('Mitsuba (7280) and Shindengen (6844). ', 'Honda-group suppliers at 0.43–0.45× book. Honda owns 11.5% of Shindengen and 3.6% of Mitsuba. Supplier groups reorganizing around a carmaker is the setup Takateru played in Ashimori (Toyoda Gosei) and DaikyoNishikawa.'));
K.push(B('Kato Works (6390). ', 'A crane maker at 0.36× book with a 5.5% dividend yield, low payout and no large holder.'));
K.push(B('Other activists already present. ', 'Ichigo Trust holds 4.3% of Ohashi Technica.'));
K.push(h2('High scorers blocked by a controlling shareholder'));
K.push(table(['Code', 'Company', 'Controlling / largest holder', 'Fit', 'Idea Str.', 'Engine'], S.blocked, [6, 22, 30, 5, 7, 10], ['', '', '', 'r', 'r', ''], 16));
K.push(h2('Cash-rich names already held by Murakami-linked investors'));
K.push(table(['Code', 'Company', 'Held by', 'Tier', 'P/B', 'Idea Str.', 'Pctile', 'Engine', 'Blocked by'], S.held, [5, 18, 22, 11, 5, 7, 6, 8, 10], ['', '', '', '', 'r', 'r', 'r', '', ''], 15));

K.push(new Paragraph({ children: [new PageBreak()] }));
K.push(h1(`4. Engine results for all ${st.n} cash-rich stocks`));
K.push(p(`Tiers: A ${st.tiers.A}, B ${st.tiers.B}, C ${st.tiers.C}, D ${st.tiers.D}. The engine ranked them in a universe of 1,257 Japanese names. Buy in stages: ${st.bis}. Watch: ${st.watch}. Eligible: ${st.elig}. Chosen by the sourcing top-20: ${st.chosen}. Blocked: G2 ${st.g2}, X-01/X-02 ${st.x01}, X-22/R-15 plus G2 ${st.x22}.`, { size: 18 }));
K.push(h2('Eligible names (passed every gate)'));
K.push(table(['Code', 'Company', 'Tier', 'Idea Strength', 'Pctile', 'Engine status', 'Chosen'], S.eligible, [6, 30, 14, 10, 8, 12, 8], ['', '', '', 'r', 'r', '', ''], 16));
K.push(p('CHIeru (3933) is the only name the sourcing step would pick. Chiyoda\'s net cash is largely customer advances, which is typical for an engineering contractor, so it isn\'t a true asset play.', { before: 80, size: 18 }));
K.push(h2('Top 25 by Idea Strength'));
K.push(table(['Code', 'Company', 'Tier', 'Mkt cap ¥B', 'P/B', 'Div. yield', 'Idea Str.', 'Pctile', 'Engine', 'Blocked by'], S.engine_top, [5, 22, 11, 7, 5, 6, 6, 5, 8, 12], ['', '', '', 'r', 'r', 'r', 'r', 'r', '', ''], 15));

K.push(h1('5. Data gaps and caveats'));
K.push(B('The value-trap gate (G2) is mostly a data artifact for Japan. ', `G2 lets a stock below book pass only with insider buying or a shareholder yield of at least 2%. For Japan the engine has dividends per share but not dividends paid or buybacks, and there is no Japanese equivalent of US insider-trading filings. So shareholder yield is always 0%. ${st.g2y} of the ${st.g2} G2-blocked names yield 2% or more on J-Quants dividend per share.`));
K.push(B('Every Japanese name is filed under the sector "Other". ', 'The engine doesn\'t map the Tokyo Stock Exchange\'s 17 sector groups, so it makes no sector calls for Japan. The macro panel is US-only, and written narratives were off because there is no Anthropic API key.'));
K.push(B('The two runs used slightly different universes. ', 'The 331-name run ranked against 1,257 names and the Murakami run against 948. Both share the same base of Japanese companies worth ¥100B or more, so the percentiles are comparable but not identical.'));
K.push(B('The fit score is mine, not the engine\'s. ', 'It describes resemblance to past entries, not a forecast. Ownership comes from top-10 lists only; stakes under 5% are not disclosed. Exit decisions are not shown.'));
K.push(B('Local changes to the engine (not committed). ', 'J-Quants coverage now starts 2016-10-01, so JQ_START in src/engine/pit/pull_jp.py was moved from 2016-09-30. The Japan build was rerun with a 16 GB swap file after running out of memory.'));
K.push(h1('Sources'));
K.push(p('Large-holding reports (大量保有報告書 / 変更報告書) from EDINET via ufocatch.com, through 2026-10-01. Prices, earnings summaries and dividends per share from J-Quants (JPX). Quarterly balance sheets from Financial Modeling Prep. Top-10 shareholders from Kabutan. Engine runs reports/evaluate/2026-09-29_033952 and 2026-09-29_061643 on branch claude/investment-philosophy-summary-218q6y.', { size: 18 }));

const A = [];
A.push(h1(`Appendix: all ${st.n} cash-rich stocks, by Idea Strength`));
A.push(table(['Code', 'Company', 'Tier', 'Mkt cap ¥B', 'P/B', 'Div. yield', 'Idea Str.', 'Pctile', 'Engine', 'Blocked by', 'Fit'], S.all, [5, 26, 4, 7, 5, 6, 6, 5, 8, 13, 4], ['', '', '', 'r', 'r', 'r', 'r', 'r', '', '', 'r'], 14, WL));

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
