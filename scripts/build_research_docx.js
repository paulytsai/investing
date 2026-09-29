// Builds reports/japan_holdings_research_<date>.docx. Needs `npm install docx`.
// Usage: node scripts/build_research_docx.js reports/murakami_holdings_<date>.csv out.docx
const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
  AlignmentType, HeadingLevel, PageOrientation, LevelFormat, BorderStyle, Footer, PageNumber,
  ExternalHyperlink, TableLayoutType } = require('docx');

const FONT = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Yu Gothic', cs: 'Arial' };
const PAGE_W = 13680; // US Letter landscape content width with 0.75" margins
const HEAD_FILL = '1F3864', ALT_FILL = 'F2F5FA', BORDER = 'BFC7D5';

const t = (text, o = {}) => new TextRun({ text: String(text), font: FONT, size: o.size || 20, bold: o.bold, italics: o.italics, color: o.color });
const p = (text, o = {}) => new Paragraph({ spacing: { after: o.after ?? 120 }, children: Array.isArray(text) ? text : [t(text, o)] });
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, font: FONT, size: 30, bold: true, color: HEAD_FILL })] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text, font: FONT, size: 24, bold: true, color: '2E5597' })] });
const bullet = (runs) => new Paragraph({ numbering: { reference: 'bul', level: 0 }, spacing: { after: 60 }, children: Array.isArray(runs) ? runs : [t(runs)] });
const lead = (b, rest) => bullet([t(b, { bold: true }), t(' ' + rest)]);

function table(headers, rows, widthsRel, align = []) {
  const total = widthsRel.reduce((a, b) => a + b, 0);
  const widths = widthsRel.map(w => Math.floor(w / total * PAGE_W));
  widths[widths.length - 1] += PAGE_W - widths.reduce((a, b) => a + b, 0);
  const border = { style: BorderStyle.SINGLE, size: 4, color: BORDER };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (txt, i, head, r) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders,
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: head ? HEAD_FILL : (r % 2 ? ALT_FILL : 'FFFFFF') },
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children: [new Paragraph({ alignment: head ? AlignmentType.LEFT : (align[i] === 'r' ? AlignmentType.RIGHT : AlignmentType.LEFT),
      children: [t(txt, { size: 17, bold: head, color: head ? 'FFFFFF' : undefined })] })],
  });
  return new Table({
    width: { size: PAGE_W, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
    rows: [new TableRow({ tableHeader: true, children: headers.map((x, i) => cell(x, i, true, 0)) }),
      ...rows.map((row, r) => new TableRow({ cantSplit: true, children: row.map((x, i) => cell(x ?? '', i, false, r)) }))],
  });
}
const gap = () => new Paragraph({ spacing: { after: 80 }, children: [] });
const link = (label, url) => new Paragraph({ numbering: { reference: 'bul', level: 0 }, spacing: { after: 40 },
  children: [new ExternalHyperlink({ link: url, children: [new TextRun({ text: label, style: 'Hyperlink', font: FONT, size: 18 })] })] });

// ---------- Murakami data from CSV ----------
function parseCSV(s) {
  s = s.replace(/^﻿/, ''); const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) { const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; } else f += c; }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...d] = rows; return d.filter(r => r.length === h.length).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
const csv = parseCSV(fs.readFileSync(process.argv[2], 'utf8'));
const EN = {"9831": "Yamada Holdings", "7278": "Exedy", "2972": "Sankei Real Estate REIT", "3864": "Mitsubishi Paper Mills", "3863": "Nippon Paper Industries", "9006": "Keikyu", "4088": "Air Water", "9274": "KPP Group Holdings", "8803": "Heiwa Real Estate", "1822": "Daiho", "1518": "Mitsui Matsushima Holdings", "6770": "Alps Alpine", "3941": "Rengo", "8032": "Japan Pulp and Paper", "367A": "Primo Global Holdings", "4767": "TOW", "2982": "AD Works Group", "5644": "Metal Art", "4246": "DaikyoNishikawa", "4464": "Soft99", "6707": "Sanken Electric", "5741": "UACJ", "4047": "Kanto Denka Kogyo", "9742": "INES", "7752": "Ricoh", "9107": "Kawasaki Kisen (K Line)", "4902": "Konica Minolta", "3401": "Teijin", "7157": "Lifenet Insurance", "7740": "Tamron", "3104": "Fujibo Holdings", "6676": "Buffalo", "8750": "Dai-ichi Life Group", "5449": "Osaka Steel", "1813": "Fudo Tetra", "1786": "Oriental Shiraishi", "6246": "Techno Smart", "7222": "Nissan Shatai", "7545": "Nishimatsuya Chain", "8013": "Naigai", "7122": "Kinki Sharyo", "8818": "Keihanshin Building", "4189": "KH Neochem", "7745": "A&D Holon Holdings", "3765": "GungHo Online Entertainment", "6516": "Sanyo Denki", "9882": "Yellow Hat", "2001": "Nippn", "8871": "Goldcrest", "8585": "Orient Corp", "5451": "Yodoko", "8141": "Shinko Shoji", "7294": "Yorozu", "4092": "Nippon Chemical Industrial", "2432": "DeNA", "9257": "YCP Holdings", "8233": "Takashimaya", "6890": "Ferrotec", "6145": "NITTOKU", "6923": "Stanley Electric", "6875": "MegaChips", "4676": "Fuji Media Holdings", "5210": "Nihon Yamamura Glass", "5541": "Pacific Metals", "5331": "Noritake", "1882": "Toa Road", "8595": "JAFCO Group", "8303": "SBI Shinsei Bank", "9640": "Saison Technology", "4917": "Mandom", "1776": "Mitsui Sumiken Doro"};
const enName = r => EN[r.code] || r.name_en || r.name;
const trendShort = s => s.replace(/Flat \(no ≥1pt change filed since .*\)/, 'Flat, no big move since then')
  .replace('Flat (latest filing had no ratio change)', 'Flat').replace(/ \((\d) of last (\d) filings (up|down)\)/, ', $1 of last $2 filings');
const GROUPS = [
  ['Murakami family (旧村上ファンド系)', 'Murakami family', 'City Index Eleventh, Aya Nomura, ATRA, Minami Aoyama Fudosan, Reno, S-Grant, Fortis, City Index First and related entities.'],
  ['Murakami Takateru (村上貴輝) / MI entities', 'Murakami Takateru', 'Yoshiaki Murakami\'s son, filing jointly with his companies MI1, MI2 and MI5.'],
  ['Effissimo Capital (founded by ex-Murakami Fund staff)', 'Effissimo Capital', 'Singapore activist fund founded by three former Murakami Fund staff.'],
  ['Strategic Capital (founded by ex-Murakami Fund staff)', 'Strategic Capital', 'Tokyo activist fund founded by a former Murakami Fund manager.'],
];
const mkRows = g => csv.filter(r => r.group === g && r.status === 'current >5%')
  .sort((a, b) => b.latest_filing.localeCompare(a.latest_filing))
  .map(r => [r.code, enName(r), r.name, (+r.joint_pct).toFixed(2) + '%',
    (+r.last_change_pt >= 0 ? '+' : '') + (+r.last_change_pt).toFixed(2), r.latest_filing,
    r.start.startsWith('before') ? 'Before ' + r.start.slice(7, 17) : r.start, trendShort(r.trend)]);
const MH = ['Code', 'Name', '銘柄', 'Held %', 'Last move (pt)', 'Latest filing', 'Position started', 'Direction'];
const MW = [6, 22, 20, 7, 8, 9, 11, 17];
const MA = ['', '', '', 'r', 'r', '', '', ''];

const murakami = [h1('1. Murakami-linked holdings above 5%'),
  p('Source: EDINET large-shareholding reports as indexed by ufocatch.com, with listing status checked against J-Quants. "Held %" is the combined stake of every entity in the group from its latest filing. "Position started" is the date the group last crossed 5%. A new report is required on every move of 1 point or more, so a position with no recent filing has stayed roughly unchanged.')];
for (const [g, label, desc] of GROUPS) {
  const rows = mkRows(g);
  murakami.push(h2(`${label} (${rows.length} positions)`), p(desc, { italics: true, size: 18 }), table(MH, rows, MW, MA), gap());
}
const cut = csv.filter(r => r.status.startsWith('cut')).sort((a, b) => b.latest_filing.localeCompare(a.latest_filing));
murakami.push(h2('Cut below 5% in the last 12 months'), p('These positions were sold down below the 5% reporting line, so later changes are no longer disclosed.', { size: 18 }),
  table(['Group', 'Code', 'Name', '銘柄', 'Last reported %', 'Filing date'],
    cut.map(r => [r.group.split(' (')[0], r.code, enName(r), r.name, (+r.joint_pct).toFixed(2) + '%', r.latest_filing]),
    [16, 6, 26, 24, 10, 10], ['', '', '', '', 'r', '']), gap());
const stale = csv.filter(r => r.status.startsWith('stale'));
murakami.push(h2('Stale filings'), p('These still show above 5% on paper, but the last filing predates 2024. SBI Shinsei Bank\'s stake was squeezed out when the bank went private in 2023, and the other two were probably tendered or sold without a closing report.', { size: 18 }),
  table(['Group', 'Code', 'Name', 'Last reported %', 'Filing date'],
    stale.map(r => [r.group.split(' (')[0], r.code, enName(r), (+r.joint_pct).toFixed(2) + '%', r.latest_filing]),
    [18, 6, 40, 14, 14], ['', '', '', 'r', '']));

// ---------- Matsui ----------
const matsui = [h1('2. Ryosuke Matsui (松井亮介)'),
  p('Director and Executive Vice President, COO and CFO of GNI Group (2160), second to founder and CEO Ying Luo. He has never filed a 5%+ large-shareholding report, and neither has his investment company, The Ranma Investments (formerly 松井合同会社). His stakes are visible only through companies\' top-10 shareholder lists and officer shareholdings in annual reports. Prices are J-Quants closes.'),
  h2('Summary of stakes'),
  table(['Code', 'Company', 'Type', 'Peak shares', '% at peak', 'Position started', 'Status', 'Direction'], [
    ['2160', 'GNI Group', 'Officer holding', '79,800', '0.14%', '2022-12-31 or earlier', 'Held', 'Increasing'],
    ['6190', 'PhoenixBio', 'Top-10 shareholder', '100,000', '2.46%', 'Apr–Sep 2025', 'Sold, off list by 2026-03-31', 'Decreasing'],
    ['3461', 'Parma', 'Top-10 shareholder', '17,100', '1.24%', '2017-09-30 or earlier', 'Sold, off list after 2018-03-31', 'Exited'],
  ], [6, 14, 14, 10, 9, 15, 20, 12], ['', '', '', 'r', 'r', '', '', '']), gap(),
  h2('GNI Group (2160) history'),
  table(['As of', 'Shares', '% of company', 'Close ¥', 'Value ¥'], [
    ['2022-12-31', '36,100', '0.08%', '1,393', '50.3M'], ['2023-12-31', '77,300', '0.16%', '2,830', '218.8M'],
    ['2024-12-31', '77,700', '0.15%', '3,405', '264.6M'], ['2025-12-31', '79,800', '0.14%', '2,412', '192.5M'],
    ['2026-09-29', '79,800', '0.14%', '3,260', '260.1M']], [20, 20, 20, 20, 20], ['', 'r', 'r', 'r', 'r']),
  p('He doubled his shares in 2023 and has added a little each year since. His percentage slipped slightly because GNI issued new shares.', { size: 18 }),
  h2('PhoenixBio (6190) history'),
  table(['As of', 'Shares', '% of company', 'Close ¥', 'Value ¥'], [
    ['2025-09-30', '100,000', '2.46%', '407', '40.7M'], ['2026-03-31', 'Off top-10 list (10th holder has 52,018)', 'Under 1.28%', '440', 'Treated as sold']],
    [20, 30, 16, 14, 20], ['', 'r', 'r', 'r', 'r']),
  h2('Parma (3461) history'),
  table(['As of', 'Shares', '% of company', 'Close ¥', 'Value ¥'], [
    ['2017-09-30', '14,600', '1.08%', '2,441', '35.6M'], ['2018-03-31', '17,100', '1.24%', '3,800', '65.0M'],
    ['2018-09-30', 'Off top-10 list', '', '', 'Treated as sold']], [20, 25, 18, 17, 20], ['', 'r', 'r', 'r', 'r']),
  p('Parma split its shares 2-for-1 twice in 2018, in July and December.', { size: 18 }),
  h2('Asset estimate'),
  p('Each stake is valued at its peak size. Dropping off a top-10 list is treated as a full sale, priced at the average close between the last list he appeared on and the first one he was missing from.'),
  table(['Stake', 'Peak shares', 'Est. cost ¥', 'Sale window and average price', 'Est. proceeds ¥ (range)', 'Est. gain ¥', 'Form now'], [
    ['GNI Group', '79,800', 'Unknown, officer shares', 'Still held, ¥3,260 today', '260.1M market value', 'n/a', 'Stock'],
    ['PhoenixBio', '100,000', '~38.4M (Apr–Sep 2025 avg ¥384)', 'Oct 2025–Mar 2026, avg ¥484', '48.4M (39.5M–67.8M)', '~+10M', 'Cash'],
    ['Parma', '17,100', '~32.2M', 'Apr–Sep 2018, avg ¥4,918 per pre-split share', '84.1M (59.9M–145.4M)', '~+52M', 'Cash'],
    ['Total', '', '', '', '~392.6M', '~+62M', '']], [11, 9, 16, 22, 18, 10, 9], ['', 'r', '', '', 'r', 'r', '']),
  gap(),
  lead('Estimated total: about ¥393 million, or roughly $2.5 million.', 'That is ¥260 million of GNI stock plus about ¥132 million of cash from the two sales.'),
  lead('Possible double count.', 'His 2023 purchase of 41,200 GNI shares cost about ¥60–115 million. If the Parma proceeds paid for it, the total is closer to ¥310–330 million.'),
  lead('This is a floor.', 'It excludes GNI stock options, salary, his investment company, stakes too small for a top-10 list and anything outside Japanese listed stocks.'),
];

// ---------- GNI ----------
const gni = [h1('3. GNI Group (2160) company profile'),
  p('A Tokyo-listed drug company (TSE Growth, market cap about ¥215 billion) whose business is mostly in China. It sells a lung-fibrosis drug there, owns a US bone-graft business and a US drug-discovery unit, and has about 990 employees, 760 of them in China.'),
  h2('Segments, FY2025 (December year-end)'),
  table(['Segment', 'Revenue', 'Operating profit', 'What it is'], [
    ['Pharma', '¥17.3B', '¥3.2B', 'Chinese drugs, led by Etuary, sold through Gyre (Nasdaq: GYRE, about 70% owned)'],
    ['Medtech', '¥7.6B', '¥1.3B', 'US orthopedic biomaterials (Berkeley Advanced Biomaterials) plus a Japanese dental lab'],
    ['Biotech', '¥0.8B', '−¥4.0B', 'Cullgen, an early-stage protein-degrader drug developer'],
    ['Group total', '¥26.8B', '−¥3.5B', '']], [14, 12, 14, 60], ['', 'r', 'r', '']), gap(),
  h2('Key products and pipeline'),
  lead('Etuary (pirfenidone).', 'Treats idiopathic pulmonary fibrosis. It holds about half of that market in China and has gross margins above 90%.'),
  lead('Hydronidone (F351).', 'Treats liver fibrosis caused by hepatitis B, which has no approved therapy. It passed Phase 3 in May 2025, and the Chinese approval application was filed in March 2026 under priority review. A US trial is planned.'),
  lead('Newer launches.', 'Contiva and Etorel launched in China in 2025.'),
  lead('Cullgen.', 'Gyre acquired it within the group in May 2026 in a roughly $300 million all-stock deal.'),
  h2('Recent results and outlook'),
  lead('The 2025 loss was mostly one-offs.', 'A prior-year ¥1.6 billion one-time gain did not repeat. There were also Cullgen listing costs, a derivatives loss, writedowns and a ¥2 billion tax charge.'),
  lead('First half of 2026.', 'Revenue was ¥11.9 billion and operating profit ¥0.5 billion. The net result was still a ¥2.0 billion loss.'),
  lead('Guidance raised in August 2026.', 'Revenue guidance went from ¥27.2 billion to ¥47.3 billion after the purchase of Ayumi Pharmaceutical, a Japanese specialty drug maker, closed on July 1, 2026. No profit forecast is given.'),
];

// ---------- Uda ----------
const uda = [h1('4. Maiko Uda (宇田麻衣子)'),
  p('Her legal name in filings is 蓮見麻衣子 (Hasumi Maiko). She is a former Fuji TV announcer with a Stanford MBA who worked as an analyst at Fidelity. Since 2009 she has managed Japanese equities at Everrich Asset Management, the advisory firm founded by her father Yutaka Uda. The two of them ranked as the top Japanese managers in Citywire\'s 2022 global Japan-equity ranking.'),
  p('Neither she nor Everrich has ever filed a 5%+ stake, and she is on no top-10 shareholder list. Her only disclosed holdings are director shareholdings. Prices are 2026-09-29 J-Quants closes.'),
  table(['Code', 'Company', 'Her role', 'Shares', '% owned', 'Value ¥', 'Position started', 'Direction'], [
    ['4689', 'LY Corp (formerly Z Holdings)', 'Outside director, audit committee, since 2021', '10,200', 'Under 0.01%', '5.3M', 'Apr 2022–Mar 2023', 'Increasing'],
    ['7069', 'CyberBuzz', 'Outside director since 2018', '10,000', '0.12%', '4.8M', 'Jun 2019–Sep 2020', 'Flat'],
    ['4056', 'Neural Group', 'Outside director since 2021', '0', '0%', '0', 'Never held', 'n/a'],
    ['Total', '', '', '', '', '~10.1M', '', '']], [6, 17, 22, 8, 9, 8, 15, 10], ['', '', '', 'r', 'r', 'r', '', '']), gap(),
  lead('LY Corp.', 'She held 5,400 shares from 2023 through 2025. The rise to 10,200 by March 2026 includes 4,800 shares still to be delivered as director pay.'),
  lead('CyberBuzz.', 'She bought 5,000 shares and has not traded since. The count doubled to 10,000 only because of a 2-for-1 split in June 2026.'),
  lead('Total disclosed: about ¥10 million, or roughly $64,000.', 'The fund she manages is almost certainly far larger, but its positions stay private because it has never crossed 5% in any stock.'),
];

const sources = [h1('Sources'),
  link('ufocatch (有報キャッチャー): EDINET large-shareholding reports', 'https://ufocatch.com/large-shareholding/holder/E35393'),
  link('kabutore: Murakami-group large-shareholding report list', 'https://www.kabutore.biz/rensyu/tairyohoyu.html?kensaku=%E6%97%A7%E6%9D%91%E4%B8%8A%E3%83%95%E3%82%A1%E3%83%B3%E3%83%89'),
  link('Kaburidge: overview of Murakami entities', 'https://kabu.bridge-salon.jp/murakamifund-stocks-held/'),
  link('IRBANK: 松井亮介', 'https://irbank.net/%E6%9D%BE%E4%BA%95%E4%BA%AE%E4%BB%8B'),
  link('Kabutan: PhoenixBio major shareholders', 'https://kabutan.jp/stock/holder?code=6190'),
  link('GNI Group executives', 'https://www.gnipharma.com/company/executive/'),
  link('GNI Group business plan, March 2026', 'https://finance-frontend-pc-dist.west.edge.storage-yahoo.jp/disclosure/20260401/20260401596840.pdf'),
  link('GNI Group forecast revision, August 2026', 'https://www.release.tdnet.info/inbs/140120260813520097.pdf'),
  link('Gyre Therapeutics Q2 2026 results', 'https://ir.gyretx.com/news-releases/news-release-details/gyre-therapeutics-reports-second-quarter-2026-and-year-date'),
  link('IRBANK officer record: 蓮見麻衣子', 'https://irbank.net/officer/%E8%93%AE%E8%A6%8B%E9%BA%BB%E8%A1%A3%E5%AD%90'),
  link('Wikipedia: 宇田麻衣子', 'https://ja.wikipedia.org/wiki/%E5%AE%87%E7%94%B0%E9%BA%BB%E8%A1%A3%E5%AD%90'),
  link('Neural Group board page', 'https://kitaishihon.com/company/4056/board-of-director'),
  p('Share prices, listing status and share counts: J-Quants (JPX) API.', { size: 18 }),
];

const cover = [
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Japanese Stock Holdings Research', font: FONT, size: 44, bold: true, color: HEAD_FILL })] }),
  new Paragraph({ spacing: { after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: HEAD_FILL, space: 4 } },
    children: [t('Murakami-linked investors, Ryosuke Matsui, GNI Group and Maiko Uda  ·  Data as of 2026-09-29', { size: 22, color: '555555' })] }),
  h2('Key findings'),
  lead('Murakami-linked investors hold more than 50 disclosed 5%+ stakes.', 'The Murakami family is buying Yamada, Nippon Paper, Keikyu and Mitsubishi Paper, and selling Exedy, Alps Alpine and Daiho. Murakami Takateru is adding to all five of his positions.'),
  lead('Ryosuke Matsui\'s disclosed assets are estimated at about ¥393 million.', 'Most of it is GNI Group stock, where he is COO and CFO. The rest is cash from selling PhoenixBio and Parma.'),
  lead('GNI Group is a China-focused drug company.', 'It depends on its lung-fibrosis drug Etuary and a pending Chinese approval for its liver drug. It raised revenue guidance to ¥47.3 billion after buying Ayumi Pharmaceutical.'),
  lead('Maiko Uda\'s disclosed holdings are about ¥10 million.', 'They are director shares in LY Corp and CyberBuzz. Her fund\'s positions are not public.'),
];

const doc = new Document({
  creator: 'investing research', title: 'Japanese Stock Holdings Research',
  styles: { default: { document: { run: { font: 'Arial', size: 20 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true, font: 'Arial' }, paragraph: { outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, font: 'Arial' }, paragraph: { outlineLevel: 1 } }] },
  numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840, orientation: PageOrientation.LANDSCAPE }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [t('Page ', { size: 16, color: '888888' }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '888888' })] })] }) },
    children: [...cover, ...murakami, ...matsui, ...gni, ...uda, ...sources],
  }],
});
Packer.toBuffer(doc).then(b => { fs.writeFileSync(process.argv[3], b); console.log('wrote', process.argv[3], b.length); });
