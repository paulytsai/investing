// Free-cash-flow-to-firm DCF in the style of Aswath Damodaran (NYU Stern):
// consensus revenue and EBIT for the explicit years, reinvestment from the
// sales-to-capital ratio, CAPM cost of equity, synthetic-rating cost of debt,
// terminal growth capped at the risk-free rate with ROIC = cost of capital.

const ERP_DEFAULT = 4.5; // equity risk premium, % (Damodaran's implied US ERP is ~4-5%)
const MARGINAL_TAX = 25; // US federal + state marginal rate, %
const EXPLICIT_YEARS = 5;

const num = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Damodaran synthetic rating: default spread from interest coverage (large firms). */
function defaultSpread(coverage) {
  if (coverage === null) return 1.5;
  const table = [
    [8.5, 0.6], [6.5, 0.8], [5.5, 1.0], [4.25, 1.2], [3, 1.6], [2.5, 2.0], [2.25, 2.4],
    [2, 3.5], [1.75, 4.75], [1.5, 6.5], [1.25, 8.0], [0.8, 10.0], [0.65, 11.5], [0.2, 12.7],
  ];
  for (const [minCov, spread] of table) if (coverage >= minCov) return spread;
  return 15.0;
}

/**
 * @param {object} p
 *  price, sharesOut, marketCap, totalDebt, cash, minorityInterest, beta,
 *  riskFree (%), erp (%), latest: {revenue, ebit, taxRate, interestExpense, investedCapital},
 *  estimates: [{date, revenue, ebit}] future fiscal years ascending (may be short),
 *  override: { wacc, g } optional (for sensitivity)
 */
export function damodaranDcf(p, override = {}) {
  const price = num(p.price), shares = num(p.sharesOut), marketCap = num(p.marketCap);
  const debt = num(p.totalDebt) || 0, cash = num(p.cash) || 0, minority = num(p.minorityInterest) || 0;
  const rf = num(p.riskFree) ?? 4.5;
  const erp = num(p.erp) ?? ERP_DEFAULT;
  const beta = clamp(num(p.beta) ?? 1, 0.6, 2.0);
  const L = p.latest || {};
  if (!marketCap || !shares || !num(L.revenue) || num(L.ebit) === null) return null;

  // Cost of capital
  const costEquity = rf + beta * erp;
  const coverage = num(L.interestExpense) > 0 ? num(L.ebit) / num(L.interestExpense) : null;
  const spread = defaultSpread(coverage);
  const preTaxCostDebt = rf + spread;
  const taxRate = clamp(num(L.taxRate) ?? MARGINAL_TAX, 0, 35);
  const costDebt = preTaxCostDebt * (1 - MARGINAL_TAX / 100);
  const wE = marketCap / (marketCap + debt), wD = debt / (marketCap + debt);
  const wacc = override.wacc ?? wE * costEquity + wD * costDebt;
  const g = override.g ?? Math.min(rf, 4.0); // stable growth capped at the risk-free rate

  // Sales-to-capital ratio from the latest year (fallback to a Damodaran-style industry average ~2.0)
  const invested = num(L.investedCapital);
  const salesToCapital = invested && invested > 0 ? clamp(num(L.revenue) / invested, 0.5, 6) : 2.0;

  // Explicit forecast: consensus where available, then fade growth to g and hold margin.
  const est = (p.estimates || []).filter((e) => num(e.revenue) && num(e.ebit) !== null).slice(0, EXPLICIT_YEARS);
  const years = [];
  let prevRev = num(L.revenue);
  let lastGrowth = est.length ? est[0].revenue / prevRev - 1 : 0.05;
  let lastMargin = est.length ? est[est.length - 1].ebit / est[est.length - 1].revenue : num(L.ebit) / num(L.revenue);
  for (let i = 0; i < EXPLICIT_YEARS; i++) {
    let revenue, ebit, source;
    if (i < est.length) {
      revenue = est[i].revenue; ebit = est[i].ebit; source = "consensus";
      lastGrowth = revenue / prevRev - 1;
    } else {
      const remaining = EXPLICIT_YEARS - est.length;
      const step = (i - est.length + 1) / (remaining + 1);
      const growth = lastGrowth + (g / 100 - lastGrowth) * step; // linear fade toward g
      revenue = prevRev * (1 + growth); ebit = revenue * lastMargin; source = "extrapolated";
    }
    const t = i < 2 ? taxRate : taxRate + (MARGINAL_TAX - taxRate) * ((i - 1) / (EXPLICIT_YEARS - 1)); // converge to marginal
    const nopat = ebit * (1 - t / 100);
    const reinvestment = Math.max(0, (revenue - prevRev) / salesToCapital);
    const fcff = nopat - reinvestment;
    const df = 1 / Math.pow(1 + wacc / 100, i + 1);
    years.push({ year: i + 1, label: est[i]?.date?.slice(0, 4) || String(Number(est[est.length - 1]?.date?.slice(0, 4) || new Date().getFullYear()) + (i - est.length + 1)), revenue, ebit, margin: ebit / revenue, taxRate: t, nopat, reinvestment, fcff, pv: fcff * df, source });
    prevRev = revenue;
  }
  // Terminal value: ROIC in stable growth = cost of capital => reinvestment rate = g / ROIC
  const last = years[years.length - 1];
  const terminalEbit = last.ebit * (1 + g / 100);
  const terminalNopat = terminalEbit * (1 - MARGINAL_TAX / 100);
  const reinvestRate = wacc > 0 ? g / wacc : 0;
  const terminalFcff = terminalNopat * (1 - reinvestRate);
  const terminalValue = wacc > g ? terminalFcff / ((wacc - g) / 100) : null;
  if (terminalValue === null) return null;
  const pvTerminal = terminalValue / Math.pow(1 + wacc / 100, EXPLICIT_YEARS);
  const pvExplicit = years.reduce((s, y) => s + y.pv, 0);
  const enterpriseValue = pvExplicit + pvTerminal;
  const equityValue = enterpriseValue - debt + cash - minority;
  const perShare = equityValue / shares;

  return {
    perShare, price, upsidePct: price ? (perShare / price - 1) * 100 : null,
    enterpriseValue, equityValue, pvExplicit, pvTerminal, terminalValue, terminalShare: pvTerminal / enterpriseValue,
    inputs: { riskFree: rf, erp, beta, costEquity, preTaxCostDebt, costDebt, spread, coverage, taxRate, marginalTax: MARGINAL_TAX, weightEquity: wE, weightDebt: wD, wacc, g, salesToCapital, reinvestRate, debt, cash, minority, shares, marketCap, consensusYears: est.length },
    years,
  };
}

/** 3x3 sensitivity of value per share to WACC and terminal growth. */
export function dcfSensitivity(p, base) {
  if (!base) return null;
  const waccs = [base.inputs.wacc - 1, base.inputs.wacc, base.inputs.wacc + 1];
  const gs = [base.inputs.g - 0.5, base.inputs.g, base.inputs.g + 0.5];
  return {
    waccs, gs,
    grid: waccs.map((w) => gs.map((g) => { const r = damodaranDcf(p, { wacc: w, g }); return r ? r.perShare : null; })),
  };
}
