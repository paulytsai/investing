const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, HeadingLevel,
  LevelFormat, BorderStyle, Footer, PageNumber, ImageRun, ExternalHyperlink, TableLayoutType, PageBreak } = require('docx');
const S = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const DIR = process.argv[3];
const FONT = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Yu Gothic', cs: 'Arial' };
const W = 9360, NAVY = '1F3864', ALT = 'F2F5FA', LINE = 'BFC7D5';
const r = (text, o = {}) => new TextRun({ text: String(text), font: FONT, size: o.size || 20, bold: o.bold, italics: o.italics, color: o.color });
const p = (runs, o = {}) => new Paragraph({ spacing: { after: o.after ?? 120, before: o.before ?? 0 }, children: Array.isArray(runs) ? runs : [r(runs, o)] });
const h1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 120 }, children: [new TextRun({ text: t, font: FONT, size: 30, bold: true, color: NAVY })] });
const h2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, keepNext: true, children: [new TextRun({ text: t, font: FONT, size: 25, bold: true, color: '2E5597' })] });
const h3 = t => new Paragraph({ spacing: { before: 120, after: 60 }, keepNext: true, children: [r(t, { bold: true, color: '333333' })] });
const bullet = runs => new Paragraph({ numbering: { reference: 'bul', level: 0 }, spacing: { after: 60 }, children: Array.isArray(runs) ? runs : [r(runs)] });
function table(headers, rows, rel, align = [], size = 16) {
  const tot = rel.reduce((a, b) => a + b, 0); const w = rel.map(x => Math.floor(x / tot * W)); w[w.length - 1] += W - w.reduce((a, b) => a + b, 0);
  const b = { style: BorderStyle.SINGLE, size: 4, color: LINE }; const borders = { top: b, bottom: b, left: b, right: b };
  const cell = (t, i, head, k) => new TableCell({ width: { size: w[i], type: WidthType.DXA }, borders, shading: { type: ShadingType.CLEAR, color: 'auto', fill: head ? NAVY : (k % 2 ? ALT : 'FFFFFF') },
    margins: { top: 40, bottom: 40, left: 80, right: 80 }, children: [new Paragraph({ alignment: !head && align[i] === 'r' ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [r(t, { size, bold: head, color: head ? 'FFFFFF' : undefined })] })] });
  const out = []; if (headers) out.push(new TableRow({ tableHeader: true, children: headers.map((x, i) => cell(x, i, true, 0)) }));
  rows.forEach((row, k) => out.push(new TableRow({ cantSplit: true, children: row.map((x, i) => cell(x ?? '', i, false, k)) })));
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: w, layout: TableLayoutType.FIXED, rows: out });
}
const link = (label, url) => new Paragraph({ numbering: { reference: 'bul', level: 0 }, spacing: { after: 40 }, children: [new ExternalHyperlink({ link: url, children: [new TextRun({ text: label, style: 'Hyperlink', font: FONT, size: 18 })] })] });
const K = [];
K.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Murakami Watchlist Through the LENS Model', font: FONT, size: 40, bold: true, color: NAVY })] }));
K.push(new Paragraph({ spacing: { after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 4 } }, children: [r('Which of the 17 companies a governance activist in the style of Robert Monks would pick  ·  Data as of 2026-09-30', { size: 20, color: '555555' })] }));
K.push(h1('Summary'));
K.push(p('Five of the 17 fit the LENS model: Futaba, TOW, TPR, Nakayama Steel Works and Kitagawa. Each has lagged the market, shows governance red flags, trades well below what better governance could unlock, and has a register an activist could win with institutional support. Nine more pass some tests but are blocked by a founder, parent or allied group, or show no value gap. Three are not LENS cases.'));
K.push(table(['Company (code)', 'Under-performance', 'Governance flags', 'Value gap', 'Collective action', 'Score', 'Verdict'], S.summary, [28, 11, 11, 10, 11, 9, 20], ['', 'r', 'r', 'r', 'r', 'r', ''], 15));
K.push(new Paragraph({ spacing: { before: 120, after: 80 }, children: [new ImageRun({ type: 'png', data: fs.readFileSync(`${DIR}/charts/lens_map.png`), transformation: { width: 624, height: 416 } })] }));
K.push(h1('What LENS was, and how it is applied here'));
K.push(p('Robert A.G. Monks and Nell Minow launched LENS in 1992 to invest in "a handful of enterprises where investor activism could engineer governance improvement—and induce rising value." It bought into underperforming companies, used shareholder rights to push for board and structural change at Sears, Kodak, Stone & Webster and Scott Paper, and earned 25.1% a year against 20.5% for the S&P 500 over six years before merging into Hermes. Monks named high pay and dependence on acquisitions as telltale signs of poor governance, and at Sears he ran a newspaper ad branding the directors "non-performing assets."'));
K.push(p('LENS did not publish a scoring rule, so the four tests below are this report\'s interpretation of its approach, using data available for Japanese companies. Each test scores 0 to 2.'));
[
 ['Underperformance. ', 'One point for a five-year price return at least 25% below TOPIX (TOPIX rose 103%), one for a return on equity more than 2 points below the cost of equity from the valuation report.'],
 ['Governance red flags. ', 'One point each, up to two, for: surplus cash of 30% or more of market value; investment securities of 20% or more of equity; a recent acquisition or merger; net debt above four times EBITDA.'],
 ['Value gap. ', 'The best of the DCF value, the value at the sector-median margin, and net cash plus securities, against the price. Two points for a gap of 50% or more, one for 20–50%.'],
 ['Collective action. ', 'LENS worked by rallying other institutions. Two points if management-friendly blocks (founders, parents, business partners, banks and insurers, employee and supplier associations) hold under 30% of the top 10 and none holds 15%; one point up to 45% with no holder above 25%; zero otherwise.'],
 ['Gates. ', 'A LENS target needs 6 or more points, a value gap and a winnable register. A company that fails either gate is at most "possible", whatever its score.'],
].forEach(([b, t]) => K.push(bullet([r(b, { bold: true }), r(t)])));
K.push(p('Limits: board independence, CEO pay and takeover defenses were not scored because the data were not available for these companies. Of the takeover defenses, only Mitsubishi Paper\'s abolition was confirmed. Registers are judged from the top 10 holders only.', { before: 80, italics: true, size: 18 }));
const sect = [['The five LENS-style targets', 'LENS target'], ['Possible, but blocked or without a value gap', 'Possible'], ['Not LENS cases', 'Not a LENS case']];
for (const [title, v] of sect) {
  K.push(new Paragraph({ children: [new PageBreak()] })); K.push(h1(title));
  for (const c of S.companies.filter(x => x.verdict === v)) {
    K.push(h2(`${c.name} (${c.code}): ${c.verdict}, ${c.tot}/8`));
    K.push(table(['Test', 'Score', 'Evidence'], c.ev, [22, 8, 70], ['', 'r', ''], 16));
    if (c.agenda) {
      K.push(h3('The LENS agenda'));
      c.agenda[0].forEach(x => K.push(bullet(x)));
      K.push(p([r('Campaign path. ', { bold: true }), r(c.agenda[1])], { before: 60 }));
    }
    if (c.note) K.push(p(c.note, { before: 80 }));
  }
}
K.push(new Paragraph({ children: [new PageBreak()] })); K.push(h1('Sources'));
[
 ['Harvard Law School Forum: Bob Monks, a life in corporate governance', 'https://corpgov.law.harvard.edu/2025/06/30/bob-monks-a-life-in-corporate-governance/'],
 ['Harvard Law School Forum: An ode to Robert Monks (the Sears contest)', 'https://corpgov.law.harvard.edu/2025/06/30/an-ode-to-robert-monks/'],
 ['Institutional Investor: Monks sees gold in governance', 'https://www.institutionalinvestor.com/article/b15136q27bvfsq/monks-sees-gold-in-governance'],
 ['Yamada Holdings and Edion merger agreement (Nihon M&A Center, 2026-06-05)', 'https://www.nihon-ma.co.jp/news/20260605_9831-77/'],
 ['Stanley Electric acquires Iwasaki Electric from Carlyle (MARR, 2026-01-29)', 'https://www.marr.jp/mainfo/news/entry/66649'],
 ['Mitsubishi Paper abolishes its takeover defense (MARR)', 'https://www.marr.jp/news/entry/60382/'],
 ['Top-10 shareholders: Kabutan, e.g. TPR', 'https://kabutan.jp/stock/holder?code=6463'],
 ['Valuations, cost of capital and asset data: the companion report, Murakami Watchlist: Damodaran-Style Valuations', 'https://pages.stern.nyu.edu/~adamodar/pc/datasets/betaJapan.xls'],
].forEach(([l, u]) => K.push(link(l, u)));
K.push(p('Prices and TOPIX: J-Quants (JPX). Financial statements: Financial Modeling Prep.', { size: 17, before: 60 }));
const doc = new Document({ creator: 'investing research', title: 'Murakami Watchlist Through the LENS Model',
  styles: { default: { document: { run: { font: 'Arial', size: 20 } } }, paragraphStyles: [
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true, font: 'Arial' }, paragraph: { outlineLevel: 0 } },
    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 25, bold: true, font: 'Arial' }, paragraph: { outlineLevel: 1 } }] },
  numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
  sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1300, left: 1440, right: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [r('LENS screen · page ', { size: 16, color: '888888' }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '888888' })] })] }) },
    children: K }] });
Packer.toBuffer(doc).then(b => { fs.writeFileSync(process.argv[4], b); console.log('wrote', process.argv[4], b.length); });
