// Free-cash-flow-to-firm DCF built around the five drivers of a growth-company
// valuation: end-state revenue, target operating margin, investment efficiency
// (sales-to-capital), cost of capital and the probability of failure.
//
// Horizon: 10 years. Consensus revenue and EBIT where analysts provide them,
// then revenue growth fades linearly to the terminal rate and the margin is
// held at the last consensus level. Reinvestment = Δrevenue / sales-to-capital,
// with the company's own ratio in the near years converging to a sustainable
// level. Taxes start at the effective rate (sheltered by accumulated losses)
// and converge to the marginal rate. The cost of capital converges from the
// company's own CAPM/synthetic-rating figure to a mature-firm level over years
// 6-10. Terminal value assumes ROIC = cost of capital. The result is weighted
// by a rating-implied probability of failure with distress proceeds.

const ERP_DEFAULT = 4.5; // equity risk premium, % (implied US ERP runs 4-5%)
const MARGINAL_TAX = 25; // US federal + state marginal rate, %
const YEARS = 10;
const CONSENSUS_MAX = 5;
const MATURE_S2C = 2.5; // sustainable sales-to-capital for a mature company
const DISTRESS_PROCEEDS = 0.5; // share of going-concern value recovered in a distress sale

const num = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Synthetic rating from interest coverage (large firms): [min coverage, rating, default spread %, 10-year cumulative default probability %]. */
const RATING_TABLE = [
  [8.5, "AAA", 0.6, 0.5], [6.5, "AA", 0.8, 1.0], [5.5, "A+", 1.0, 1.5], [4.25, "A", 1.2, 2.0], [3, "A-", 1.6, 2.5],
  [2.5, "BBB", 2.0, 4.0], [2.25, "BB+", 2.4, 8.0], [2, "BB", 3.5, 12.0], [1.75, "B+", 4.75, 20.0], [1.5, "B", 6.5, 28.0],
  [1.25, "B-", 8.0, 35.0], [0.8, "CCC", 10.0, 50.0], [0.65, "CC", 11.5, 60.0], [0.2, "C", 12.7, 70.0],
];

function syntheticRating(coverage, ebit, cash) {
  if (ebit !== null && ebit < 0) {
    // Loss-making: survival depends on the cash runway against the operating burn.
    const runwayYears = cash > 0 ? cash / -ebit : 0;
    return runwayYears >= 3 ? { rating: "B", spread: 6.5, failure: 15 } : { rating: "CCC", spread: 10.0, failure: 30 };
  }
  if (coverage === null) return { rating: "AA", spread: 0.8, failure: 1.0 }; // profitable, no interest expense
  for (const [minCov, rating, spread, failure] of RATING_TABLE) if (coverage >= minCov) return { rating, spread, failure };
  return { rating: "D", spread: 15.0, failure: 80 };
}

/**
 * @param {object} p
 *  price, sharesOut, dilutedShares, marketCap, totalDebt, leases, cash, nonOperatingAssets, minorityInterest, beta,
 *  riskFree (%), erp (%), nol (accumulated operating losses, same unit as revenue),
 *  latest: {revenue, ebit, taxRate, interestExpense, investedCapital},
 *  estimates: [{date, revenue, ebit}] future fiscal years ascending (may be short)
 * @param {object} override  { waccShift (pts), g, growthShift (pts), marginShift (pts) } for sensitivity tables
 */
export function damodaranDcf(p, override = {}) {
  const price = num(p.price), marketCap = num(p.marketCap);
  const shares = Math.max(num(p.sharesOut) || 0, num(p.dilutedShares) || 0) || null;
  const debt = (num(p.totalDebt) || 0) + (num(p.leases) || 0);
  const cash = num(p.cash) || 0, nonOp = num(p.nonOperatingAssets) || 0, minority = num(p.minorityInterest) || 0;
  const rf = num(p.riskFree) ?? 4.5;
  const erp = num(p.erp) ?? ERP_DEFAULT;
  const beta = clamp(num(p.beta) ?? 1, 0.6, 2.0);
  const L = p.latest || {};
  if (!marketCap || !shares || !num(L.revenue) || num(L.ebit) === null) return null;

  // Cost of capital today, and the mature-firm level it converges to (beta 1, same spread floor).
  const costEquity = rf + beta * erp;
  const coverage = num(L.interestExpense) > 0 ? num(L.ebit) / num(L.interestExpense) : null;
  const rating = syntheticRating(coverage, num(L.ebit), cash);
  const preTaxCostDebt = rf + rating.spread;
  const costDebt = preTaxCostDebt * (1 - MARGINAL_TAX / 100);
  const wE = marketCap / (marketCap + debt), wD = debt / (marketCap + debt);
  const waccShift = num(override.waccShift) || 0; // sensitivity: shifts today's and the mature cost of capital together
  const waccNow = wE * costEquity + wD * costDebt + waccShift;
  const matureCostDebt = (rf + Math.min(rating.spread, 1.2)) * (1 - MARGINAL_TAX / 100);
  const waccMature = wE * (rf + erp) + wD * matureCostDebt + waccShift;
  const g = override.g ?? Math.min(rf, 4.0); // stable growth capped at the risk-free rate
  const waccAt = (i) => (i < 5 ? waccNow : waccNow + (waccMature - waccNow) * ((i - 4) / 5)); // years 6-10 converge
  const growthShift = (num(override.growthShift) || 0) / 100;
  const marginShift = (num(override.marginShift) || 0) / 100;

  // Investment efficiency: the company's own ratio near term, converging to a sustainable level by year 10.
  const invested = num(L.investedCapital);
  const s2cNow = invested && invested > 0 ? clamp(num(L.revenue) / invested, 0.5, 6) : 2.0;
  const s2cMature = Math.min(s2cNow, MATURE_S2C);
  const s2cAt = (i) => (i < 5 ? s2cNow : s2cNow + (s2cMature - s2cNow) * ((i - 4) / 5));

  // Taxes: effective rate converging to marginal; accumulated losses shelter early profits.
  const taxRateNow = clamp(num(L.taxRate) ?? MARGINAL_TAX, 0, 35);
  let nol = Math.max(0, num(p.nol) || 0);

  const est = (p.estimates || []).filter((e) => num(e.revenue) && num(e.ebit) !== null).slice(0, CONSENSUS_MAX);
  const years = [];
  let prevRev = num(L.revenue);
  let growth = est.length ? est[0].revenue / prevRev - 1 : 0.05;
  const targetMargin = (est.length ? est[est.length - 1].ebit / est[est.length - 1].revenue : num(L.ebit) / num(L.revenue)) + marginShift;
  const baseYear = Number(est[est.length - 1]?.date?.slice(0, 4) || new Date().getFullYear());
  let cumDf = 1;
  let pathGrowth = growth; // unshifted growth path used for the linear fade
  for (let i = 0; i < YEARS; i++) {
    let revenue, ebit, source;
    const prevMargin = i === 0 ? num(L.ebit) / num(L.revenue) : years[i - 1].margin;
    if (i < est.length) {
      revenue = est[i].revenue; ebit = est[i].ebit; source = "consensus";
      growth = revenue / prevRev - 1; pathGrowth = growth;
      // Phase the margin override in over the consensus years so the sensitivity grid stays continuous.
      if (marginShift) ebit = revenue * (ebit / revenue + marginShift * ((i + 1) / est.length));
    } else {
      const remaining = YEARS - est.length;
      const stepsLeft = remaining - (i - est.length);
      pathGrowth += (g / 100 - pathGrowth) / stepsLeft; // linear fade to the terminal rate by year 10
      growth = pathGrowth + growthShift;
      revenue = prevRev * (1 + growth); source = "extrapolated";
      ebit = revenue * (prevMargin + (targetMargin - prevMargin) / stepsLeft);
    }
    const taxRate = taxRateNow + (MARGINAL_TAX - taxRateNow) * (i / (YEARS - 1));
    let taxable = ebit;
    if (ebit < 0) { nol += -ebit; taxable = 0; }
    else if (nol > 0) { const used = Math.min(nol, ebit); nol -= used; taxable = ebit - used; }
    const tax = taxable * (taxRate / 100);
    const nopat = ebit - tax;
    const s2c = s2cAt(i);
    const reinvestment = Math.max(0, (revenue - prevRev) / s2c);
    const fcff = nopat - reinvestment;
    const wacc = waccAt(i);
    cumDf /= 1 + wacc / 100;
    years.push({ year: i + 1, label: String(baseYear + (i - est.length + 1)), revenue, ebit, margin: ebit / revenue, growth, taxRate, nopat, reinvestment, fcff, wacc, salesToCapital: s2c, pv: fcff * cumDf, source });
    prevRev = revenue;
  }

  // Terminal value: ROIC in stable growth = cost of capital => reinvestment rate = g / ROIC.
  const last = years[years.length - 1];
  const terminalEbit = last.ebit * (1 + g / 100);
  const terminalNopat = terminalEbit * (1 - MARGINAL_TAX / 100);
  const reinvestRate = waccMature > 0 ? g / waccMature : 0;
  const terminalFcff = terminalNopat * (1 - reinvestRate);
  if (waccMature <= g || terminalFcff <= 0) return null;
  const terminalValue = terminalFcff / ((waccMature - g) / 100);
  const pvTerminal = terminalValue * cumDf;
  const pvExplicit = years.reduce((s, y) => s + y.pv, 0);
  const goingConcernValue = pvExplicit + pvTerminal;
  // Expected value across survival and failure (distress sale recovers a fraction of going-concern value).
  const failure = rating.failure / 100;
  const enterpriseValue = goingConcernValue * (1 - failure) + goingConcernValue * DISTRESS_PROCEEDS * failure;
  const equityValue = enterpriseValue - debt + cash + nonOp - minority;
  const perShare = equityValue / shares;
  const revenueCagr = Math.pow(last.revenue / num(L.revenue), 1 / YEARS) - 1;

  return {
    perShare, price, upsidePct: price ? (perShare / price - 1) * 100 : null,
    enterpriseValue, goingConcernValue, equityValue, pvExplicit, pvTerminal, terminalValue, terminalShare: pvTerminal / goingConcernValue,
    story: { endRevenue: last.revenue, revenueCagrPct: revenueCagr * 100, targetMarginPct: last.margin * 100, currentMarginPct: (num(L.ebit) / num(L.revenue)) * 100, salesToCapitalNow: s2cNow, salesToCapitalMature: s2cMature, waccNow, waccMature, failurePct: rating.failure, rating: rating.rating, distressProceedsPct: DISTRESS_PROCEEDS * 100 },
    inputs: { riskFree: rf, erp, beta, costEquity, preTaxCostDebt, costDebt, spread: rating.spread, coverage, taxRate: taxRateNow, marginalTax: MARGINAL_TAX, weightEquity: wE, weightDebt: wD, wacc: waccNow, waccMature, g, salesToCapital: s2cNow, reinvestRate, debt, leases: num(p.leases) || 0, cash, nonOperatingAssets: nonOp, minority, nol: Math.max(0, num(p.nol) || 0), shares, marketCap, consensusYears: est.length, horizonYears: YEARS },
    years,
  };
}

/** Sensitivity of value per share: 3x3 on WACC × terminal growth, and 3x3 on revenue growth × target margin. */
export function dcfSensitivity(p, base) {
  if (!base) return null;
  const run = (o) => damodaranDcf(p, o);
  const per = (r) => (r ? r.perShare : null);
  const waccs = [base.inputs.wacc - 1, base.inputs.wacc, base.inputs.wacc + 1];
  const gs = [base.inputs.g - 0.5, base.inputs.g, base.inputs.g + 0.5];
  const growthShifts = [-3, 0, 3];
  const marginShifts = [-3, 0, 3];
  const storyRuns = growthShifts.map((gs2) => marginShifts.map((ms) => run({ growthShift: gs2, marginShift: ms })));
  return {
    waccs, gs,
    grid: [-1, 0, 1].map((ws) => gs.map((g) => per(run({ waccShift: ws, g })))),
    growthShifts, marginShifts,
    storyGrid: storyRuns.map((row) => row.map(per)),
    // Axis labels: 10-year revenue CAGR and year-10 margin that each shift produces.
    storyAxis: { cagr: storyRuns.map((row) => (row[1] ? row[1].story.revenueCagrPct : null)), endRevenue: storyRuns.map((row) => (row[1] ? row[1].story.endRevenue : null)), margin: marginShifts.map((s) => base.story.targetMarginPct + s) },
  };
}
