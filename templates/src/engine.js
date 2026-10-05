// ENGINE START
// Pure model engine: no DOM. Shared by the page and by tests.
const isNum = (v) => typeof v === "number" && isFinite(v);
const n = (v) => (isNum(v) ? v : null);
const div = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);
const sub = (a, b) => (isNum(a) && isNum(b) ? a - b : null);
const sum = (...xs) => (xs.every(isNum) ? xs.reduce((s, x) => s + x, 0) : null);
const growth = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? (a - b) / Math.abs(b) : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- line-item accessors (FMP field names) ----------
const da = (c) => n(c.c?.depreciationAndAmortization) ?? n(c.i?.depreciationAndAmortization);
const rev = (c) => n(c?.i?.revenue);
const ebit = (c) => n(c?.i?.operatingIncome);
const ebitda = (c) => n(c.i?._ebitda) ?? sum(ebit(c), da(c));
const cashST = (c) => n(c.b?.cashAndShortTermInvestments) ?? sum(n(c.b?.cashAndCashEquivalents), n(c.b?.shortTermInvestments));
const debt = (c) => n(c.b?.totalDebt);
const capex = (c) => n(c.c?.capitalExpenditure) ?? n(c.c?.investmentsInPropertyPlantAndEquipment);
const cfo = (c) => n(c.c?.netCashProvidedByOperatingActivities) ?? n(c.c?.operatingCashFlow);
const fcf = (c) => n(c.c?.freeCashFlow) ?? sum(cfo(c), capex(c));
const taxRate = (c) => div(n(c.i?.incomeTaxExpense), n(c.i?.incomeBeforeTax));
const ar = (c) => n(c.b?.accountsReceivables) || n(c.b?.netReceivables);
const divPaid = (c) => { const v = n(c.c?.netDividendsPaid) ?? n(c.c?.commonDividendsPaid); return isNum(v) ? -v : null; };
const buyback = (c) => { const v = n(c.c?.commonStockRepurchased); return isNum(v) ? -v : null; };
const defRev = (c) => (c.b ? (n(c.b.deferredRevenue) ?? 0) + (n(c.b.deferredRevenueNonCurrent) ?? 0) : null);
// FMP folds lease liabilities into totalDebt on some balance sheets and not on others: count them only where included
const leaseInDebt = (c) => {
  const L = n(c?.b?.capitalLeaseObligations), td = n(c?.b?.totalDebt);
  if (!isNum(L) || L <= 0 || !isNum(td)) return 0;
  return td >= (n(c.b.shortTermDebt) ?? 0) + (n(c.b.longTermDebt) ?? 0) + L - 1e6 ? L : 0;
};
// Content-type investment (e.g. a streamer's film and series spend) is reported inside operating cash flow
// (FMP otherNonCashItems) while its amortization sits in D&A
const contSpend = (c) => { const o = n(c?.c?.otherNonCashItems); return isNum(o) && o < 0 ? -o : 0; };

// ---------- building actual / consensus columns ----------
const yy = (fy) => String(fy).slice(-2);
const asc = (a) => (Array.isArray(a) ? a : []).filter((r) => r && r.fiscalYear != null && r.date).sort((x, y) => String(x.date).localeCompare(String(y.date)));
const byKey = (a) => { const m = {}; (Array.isArray(a) ? a : []).forEach((r) => { if (r && r.fiscalYear != null) m[(r.period || "FY") + "|" + r.fiscalYear] = r; }); return m; };
const META = new Set(["_revLo", "_revHi", "_epsLo", "_epsHi", "date", "symbol", "reportedCurrency", "cik", "filingDate", "acceptedDate", "fiscalYear", "period", "_nAnalysts"]);
const AVG = new Set(["weightedAverageShsOut", "weightedAverageShsOutDil"]);
function sumRecs(recs) {
  if (!recs.length || recs.some((r) => !r)) return undefined;
  const keys = new Set(); recs.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
  const out = {};
  keys.forEach((k) => { if (META.has(k)) return; const vs = recs.map((r) => r[k]); if (vs.every(isNum)) out[k] = AVG.has(k) ? vs.reduce((a, b) => a + b, 0) / vs.length : vs.reduce((a, b) => a + b, 0); });
  return out;
}
function sumSeg(ds) {
  if (!ds.length || ds.some((d) => !d)) return undefined;
  const out = {};
  Object.keys(ds[0]).forEach((k) => { const vs = ds.map((d) => d[k]); if (vs.every(isNum)) out[k] = vs.reduce((a, b) => a + b, 0); });
  return out;
}
const estToI = (e) => ({ _revLo: n(e.revenueLow), _revHi: n(e.revenueHigh), _epsLo: n(e.epsLow), _epsHi: n(e.epsHigh), revenue: n(e.revenueAvg), operatingIncome: n(e.ebitAvg), netIncome: n(e.netIncomeAvg), epsDiluted: n(e.epsAvg), sellingGeneralAndAdministrativeExpenses: n(e.sgaExpenseAvg), _ebitda: n(e.ebitdaAvg), _nAnalysts: n(e.numAnalystsEps) ?? n(e.numAnalystsRevenue) });
const FY_CTX = { A: 1, D: 365, type: "FY" }, Q_CTX = { A: 4, D: 91.25, type: "Q" }, H_CTX = { A: 2, D: 182.5, type: "H" };
const MODEL_YEARS = 5;
const SH_BAND = 0.06; // largest one-year change in diluted shares accepted from consensus (net income / EPS)
const CONS_YEARS = 3;
const FIXED_GROWTH_CAP = 0.03; // consensus shown (and used for default drivers) for the current year + 2

function buildActuals(raw) {
  const incA = asc(raw.incA), bsA = byKey(raw.bsA), cfA = byKey(raw.cfA), prodA = byKey(raw.prodA), geoA = byKey(raw.geoA);
  const incQ = asc(raw.incQ), bsQ = byKey(raw.bsQ), cfQ = byKey(raw.cfQ), prodQ = byKey(raw.prodQ), geoQ = byKey(raw.geoQ);
  if (!incA.length) return null;

  const fyA = {};
  incA.forEach((r) => { const k = "FY|" + r.fiscalYear; fyA[+r.fiscalYear] = { ...FY_CTX, kind: "A", fy: +r.fiscalYear, label: "FY" + r.fiscalYear, i: r, b: bsA[k], c: cfA[k], prod: prodA[k]?.data, geo: geoA[k]?.data, date: r.date }; });
  Object.values(fyA).forEach((c) => { c.p = fyA[c.fy - 1] || null; });
  const lastA = incA[incA.length - 1];
  const curFY = +lastA.fiscalYear + 1;

  // Annual consensus, mapped to fiscal years by distance from the last reported year end
  const consFy = {};
  const baseA = Date.parse(lastA.date);
  (Array.isArray(raw.estA) ? raw.estA : []).forEach((e) => {
    const dd = (Date.parse(e.date) - baseA) / 864e5; if (!(dd > 180)) return;
    const fy = +lastA.fiscalYear + Math.round(dd / 365.25);
    if (fy >= curFY + CONS_YEARS) return;
    consFy[fy] = { ...FY_CTX, kind: "C", fy, label: "FY" + fy, i: estToI(e), date: e.date };
  });

  const qA = {}, qE = {};
  incQ.forEach((r) => { const k = r.period + "|" + r.fiscalYear; qA[k] = { ...Q_CTX, kind: "A", label: r.period + " FY" + yy(r.fiscalYear), i: r, b: bsQ[k], c: cfQ[k], prod: prodQ[k]?.data, geo: geoQ[k]?.data, date: r.date }; });
  const lastQ = incQ[incQ.length - 1];
  if (lastQ && /^Q[1-4]$/.test(lastQ.period)) {
    const baseQ = Date.parse(lastQ.date), qn = +lastQ.period.slice(1);
    (Array.isArray(raw.estQ) ? raw.estQ : []).forEach((e) => {
      const dd = (Date.parse(e.date) - baseQ) / 864e5; if (!(dd > 45)) return;
      const idx = qn - 1 + Math.round(dd / 91.31);
      const fy = +lastQ.fiscalYear + Math.floor(idx / 4), q = (idx % 4) + 1;
      const k = "Q" + q + "|" + fy;
      if (!qA[k]) qE[k] = { ...Q_CTX, kind: "C", label: "Q" + q + " FY" + yy(fy), i: estToI(e), date: e.date };
    });
  }
  // Regions from the latest 10-K (EDGAR XBRL): the filing's own labels and restated comparatives replace
  // FMP's for those years; earlier FMP years with the same region set are relabeled by matching values
  // (FMP can carry a stale label forward, e.g. NVIDIA's "Other Countries" shown as "Other Americas").
  const eg = (raw.edgarGeo?.groups || []).find((g) => /sums_to_total/.test(g.check || "")) || (raw.edgarGeo?.groups || [])[0];
  const geoNote = { years: [], renamed: {} };
  if (eg && Array.isArray(eg.members)) {
    const fyByDate = (d) => Object.values(fyA).find((c) => Math.abs(Date.parse(c.date) - Date.parse(d)) < 20 * 864e5);
    const periods = [...new Set(eg.members.flatMap((mb) => Object.keys(mb.values || {})))];
    const fmpOrig = {};
    periods.forEach((d) => {
      const c = fyByDate(d); if (!c) return;
      const map = {};
      eg.members.forEach((mb) => { const v = mb.values?.[d]; if (isNum(v) && !mb.overlaps) map[mb.name] = v; });
      if (!Object.keys(map).length) return;
      fmpOrig[c.fy] = c.geo; c.geo = map; c.geoSrc = "10-K"; geoNote.years.push(c.fy);
    });
    // relabel FMP names by value in the latest overlapping year
    const ref = geoNote.years.slice().sort((a, b) => b - a).find((fy) => fmpOrig[fy]);
    if (ref) {
      const f0 = fmpOrig[ref], e0 = fyA[ref].geo, rename = {};
      Object.entries(f0).forEach(([k, v]) => { if (!isNum(v)) return; const hit = Object.entries(e0).find(([, ev]) => Math.abs(ev - v) <= 0.01 * Math.abs(ev)); if (hit && hit[0] !== k) rename[k] = hit[0]; });
      const keySet = (o) => Object.keys(o || {}).sort().join("|");
      const refSet = keySet(f0);
      // a single country means the same thing in every year; a catch-all bucket only where the region set matches
      const catchAll = (nm) => /other|rest of|non[- ]?u\.?s|international|elsewhere/i.test(nm);
      const relabel = (c) => {
        if (!c.geo || c.geoSrc) return;
        const same = keySet(c.geo) === refSet;
        const g = {};
        Object.entries(c.geo).forEach(([k, v]) => { const to = rename[k]; g[to && (same || (!catchAll(k) && !catchAll(to))) ? to : k] = v; });
        c.geo = g; c.geoRelabeled = true;
      };
      if (Object.keys(rename).length) { Object.values(fyA).forEach(relabel); Object.values(qA).forEach(relabel); geoNote.renamed = rename; }
    }
    geoNote.years.sort((a, b) => a - b);
  }

  // Overlay segment detail read from SEC earnings releases (keyed by quarter-end date)
  const sec = raw.secSeg || {};
  const secFor = (date) => { const t = Date.parse(date); const k = Object.keys(sec).find((d) => Math.abs(Date.parse(d) - t) < 8 * 864e5); return k ? sec[k] : null; };
  Object.values(qA).forEach((c) => {
    const s = secFor(c.date); if (!s) return;
    if (s.geo && Object.keys(s.geo).length) c.geo = s.geo;
    if (s.prod && Object.keys(s.prod).length) c.prod = s.prod;
    if (s.segEbit && Object.keys(s.segEbit).length) c.segEbit = s.segEbit;
    c.secSrc = s.src;
  });

  // Data check: a quarter whose segments cover a very different share of revenue than the
  // fiscal year does is probably mis-tagged upstream (e.g. a missing quarter folded into Q4)
  const cover = (c, f) => { const v = Object.values(c?.[f] || {}).filter(isNum); return v.length && rev(c) ? v.reduce((a, b) => a + b, 0) / rev(c) : null; };
  const median = (xs) => { const v = xs.filter(isNum).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  ["prod", "geo"].forEach((f) => {
    // what this company's segments usually cover, over the last eight reported quarters
    const recent = incQ.slice(-8).map((r) => qA[r.period + "|" + r.fiscalYear]);
    const norm = median(recent.map((c) => cover(c, f))) ?? 1;
    Object.values(qA).forEach((c) => {
      const q = cover(c, f);
      if (isNum(q) && Math.abs(q / norm - 1) > 0.05) (c.segBad = c.segBad || {})[f] = { q, norm };
    });
  });

  const quarter = (q, fy) => qA["Q" + q + "|" + fy] || qE["Q" + q + "|" + fy] || { ...Q_CTX, kind: "C", label: "Q" + q + " FY" + yy(fy) };
  const half = (qs, label) => ({
    ...H_CTX, label, kind: qs.every((c) => c && c.kind === "A") ? "A" : "C",
    i: sumRecs(qs.map((c) => c && c.i)), c: sumRecs(qs.map((c) => c && c.c)), b: qs[qs.length - 1]?.b,
    prod: sumSeg(qs.map((c) => c && c.prod)), geo: sumSeg(qs.map((c) => c && c.geo)), segEbit: sumSeg(qs.map((c) => c && c.segEbit)),
    segBad: qs.some((c) => c?.segBad?.prod) || qs.some((c) => c?.segBad?.geo) ? { prod: qs.some((c) => c?.segBad?.prod), geo: qs.some((c) => c?.segBad?.geo) } : undefined,
  });
  // One fiscal year by quarter: Q1, Q2, H1, Q3, Q4, H2, each linked to the same period a year earlier
  const yearByQuarter = (fy, actualOnly) => {
    const qs = [1, 2, 3, 4].map((q) => (actualOnly ? qA["Q" + q + "|" + fy] || { ...Q_CTX, kind: "A", label: "Q" + q + " FY" + yy(fy) } : quarter(q, fy)));
    const pq = [1, 2, 3, 4].map((q) => qA["Q" + q + "|" + (fy - 1)] || null);
    qs.forEach((c, j) => { c.p = pq[j]; c.fy = fy; });
    const h1 = half(qs.slice(0, 2), "H1 FY" + yy(fy)), h2 = half(qs.slice(2), "H2 FY" + yy(fy));
    h1.fy = h2.fy = fy;
    if (pq.every(Boolean)) { h1.p = half(pq.slice(0, 2), ""); h2.p = half(pq.slice(2), ""); h1.p.fy = h2.p.fy = fy - 1; }
    pq.forEach((c) => { if (c) c.fy = fy - 1; });
    const cols = [qs[0], qs[1], h1, qs[2], qs[3], h2];
    cols.forEach((c) => { c.drill = true; c.drillFy = fy; });
    return { cols, qs };
  };
  const prevYear = yearByQuarter(curFY - 1, true);
  const curYear = yearByQuarter(curFY, false);
  const cq = curYear.qs;
  const drillPrev = prevYear.cols;
  const drill = curYear.cols;

  // Consensus columns for the model years, chained for YoY
  const cons = [];
  let prevC = fyA[curFY - 1] || null;
  for (let k = 0; k < CONS_YEARS; k++) {
    const fy = curFY + k;
    const c = consFy[fy] ? { ...consFy[fy] } : { ...FY_CTX, kind: "C", fy, label: "FY" + fy };
    c.p = prevC; prevC = c; c.consCol = true; cons.push(c);
  }

  // LTM = last four reported quarters; latest balance sheet = latest quarter
  const lastFour = incQ.slice(-4).map((r) => qA[r.period + "|" + r.fiscalYear]);
  const ltm = lastFour.length === 4
    ? { ...FY_CTX, kind: "A", i: sumRecs(lastFour.map((c) => c.i)), c: sumRecs(lastFour.map((c) => c.c)), b: lastFour[3].b || fyA[+lastA.fiscalYear].b }
    : fyA[+lastA.fiscalYear];
  const latestShares = n(lastQ?.weightedAverageShsOutDil) ?? n(lastA.weightedAverageShsOutDil);

  return { geoNote, fyA, hist: incA.map((r) => fyA[+r.fiscalYear]), drill, drillPrev, cons, consFy, curFY, ltm, lastA, lastQ, latestShares, nReportedQ: cq.filter((c) => c.kind === "A").length };
}

// ---------- regression: operating profit on revenue ----------
// OLS of year-over-year changes, dEBIT = a + b * dRevenue, over the last n fiscal years.
// Changes rather than levels: levels of two growing series correlate whether or not they are
// related. b is the statistical incremental margin. Also reports the log-change elasticity
// (operating leverage): dln EBIT = a + b * dln Revenue, on years with positive EBIT.
const T90 = [[1, 6.314], [2, 2.92], [3, 2.353], [4, 2.132], [5, 2.015], [6, 1.943], [7, 1.895], [8, 1.86], [9, 1.833], [10, 1.812], [12, 1.782], [15, 1.753], [20, 1.725], [30, 1.697]];
const tcrit = (df) => { let t = 1.645; for (const [d, v] of T90) if (df >= d) t = v; return df < 1 ? null : t; };
function ols(pts, icpt) {
  const k = pts.length; if (k < (icpt ? 3 : 2)) return null;
  const mx = icpt ? pts.reduce((s, p) => s + p.x, 0) / k : 0, my = icpt ? pts.reduce((s, p) => s + p.y, 0) / k : 0;
  let sxx = 0, sxy = 0, syy = 0;
  pts.forEach((p) => { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) ** 2; });
  if (!(sxx > 0)) return null;
  const beta = sxy / sxx, alpha = my - beta * mx;
  const ssr = pts.reduce((s, p) => s + (p.y - alpha - beta * p.x) ** 2, 0);
  const df = k - (icpt ? 2 : 1);
  const se = df > 0 ? Math.sqrt(ssr / df / sxx) : null;
  const yMean = pts.reduce((s, p) => s + p.y, 0) / k;
  const sst = pts.reduce((s, p) => s + (p.y - yMean) ** 2, 0);
  const r2 = sst > 0 ? 1 - ssr / sst : null;
  const tc = tcrit(df);
  return { n: k, beta, alpha, se, t: se ? beta / se : null, r2, df, lo: se && tc ? beta - tc * se : null, hi: se && tc ? beta + tc * se : null };
}
// Refit once without points whose residual exceeds 2 standard errors (one-off charges, disposals)
function trimmed(pts, fitFn, resid) {
  const f0 = fitFn(pts); if (!f0) return { fit: null, used: pts, dropped: [] };
  const r = pts.map((p) => resid(f0, p));
  const sd = Math.sqrt(r.reduce((s, e) => s + e * e, 0) / Math.max(pts.length - 2, 1));
  const keep = pts.filter((p, i) => Math.abs(r[i]) <= 2 * sd);
  if (keep.length === pts.length || keep.length < 5) return { fit: f0, used: pts, dropped: [] };
  return { fit: fitFn(keep) || f0, used: keep, dropped: pts.filter((p) => !keep.includes(p)) };
}
function regressIncr(m, nYears, icpt, robust) {
  const last = m.curFY - 1;
  const pts = [], lpts = [];
  for (let fy = last - nYears + 1; fy <= last; fy++) {
    const c = m.fyA[fy], p = m.fyA[fy - 1];
    if (!c || !p) continue;
    const r1 = rev(c), r0 = rev(p), e1 = ebit(c), e0 = ebit(p);
    if (![r1, r0, e1, e0].every(isNum)) continue;
    pts.push({ fy, x: r1 - r0, y: e1 - e0 });
    if (e1 > 0 && e0 > 0 && r1 > 0 && r0 > 0) lpts.push({ fy, x: Math.log(r1 / r0), y: Math.log(e1 / e0) });
  }
  const t = robust ? trimmed(pts, (ps) => ols(ps, icpt), (f, p) => p.y - f.alpha - f.beta * p.x) : { fit: ols(pts, icpt), dropped: [] };
  return { fit: t.fit, dropped: t.dropped.map((p) => p.fy), elast: ols(lpts, true), pts, icpt, nYears };
}

// Cost-structure regression (operating leverage). Cash operating costs (revenue - EBIT - D&A) are
// split into a fixed part that drifts with time and a part that scales with revenue:
//   cost_t = F0 + d * t + v * revenue_t
// v = variable cost ratio (contribution margin = 1 - v); F0 + d*t = fixed cash costs in year t.
// High fixed costs mean profit moves more than sales (DOL = contribution / EBIT > 1), and the
// incremental margin then depends on growth, so a single dEBIT/dRevenue slope fits poorly.
function inv3(a) {
  const [[a0, a1, a2], [b0, b1, b2], [c0, c1, c2]] = a;
  const det = a0 * (b1 * c2 - b2 * c1) - a1 * (b0 * c2 - b2 * c0) + a2 * (b0 * c1 - b1 * c0);
  if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    [(b1 * c2 - b2 * c1) / det, (a2 * c1 - a1 * c2) / det, (a1 * b2 - a2 * b1) / det],
    [(b2 * c0 - b0 * c2) / det, (a0 * c2 - a2 * c0) / det, (a2 * b0 - a0 * b2) / det],
    [(b0 * c1 - b1 * c0) / det, (a1 * c0 - a0 * c1) / det, (a0 * b1 - a1 * b0) / det],
  ];
}
function costRegress(m, nYears, robust) {
  const last = m.curFY - 1, all = [];
  for (let fy = last - nYears + 1; fy <= last; fy++) {
    const c = m.fyA[fy]; if (!c) continue;
    const r = rev(c), e = ebit(c), d = da(c) ?? 0;
    if (![r, e].every(isNum)) continue;
    all.push({ fy, t: fy - last, rev: r, cost: r - e - d, ebit: e, da: d });
  }
  const fitFn = (ps) => costFit(ps);
  const tr = robust ? trimmed(all, fitFn, (f, p) => (p.cost - (f.b0 + f.b1 * p.t + f.v * p.rev / 1e9) * 1e9) / 1e9) : { fit: fitFn(all), used: all, dropped: [] };
  const pts = all, f = tr.fit;
  const B = all[all.length - 1];
  if (!f || !B || B.t !== 0) return { pts, fit: null, dropped: [] };
  const v = f.v;
  const contribution = B.rev * (1 - v);
  // anchor fixed costs to the base year actuals so the forecast starts from reported EBIT
  const fixedB = B.cost - v * B.rev;
  const fixedShare = div(fixedB + B.da, B.cost + B.da); // D&A counted as fixed
  const dol = div(contribution, B.ebit);
  const valid = v > 0 && v < 1 && fixedB > 0;
  return {
    pts, dropped: tr.dropped.map((p) => p.fy), fit: f,
    fixedB, fixedShare, dol, contribution, fixedGrowth: valid ? clamp(f.drift / fixedB, -0.1, 0.25) : null, valid,
    profile: !valid ? "unclear" : (fixedShare > 0.5 || (isNum(dol) && dol > 2)) ? "high" : fixedShare < 0.3 ? "low" : "mid",
  };
}
function costFit(pts) {
  const k = pts.length; if (k < 5) return null;
  // scale to billions for numerical stability
  const S = 1e9, X = pts.map((p) => [1, p.t, p.rev / S]), Y = pts.map((p) => p.cost / S);
  const XtX = [0, 1, 2].map((i) => [0, 1, 2].map((j) => X.reduce((s, x) => s + x[i] * x[j], 0)));
  const XtY = [0, 1, 2].map((i) => X.reduce((s, x, r) => s + x[i] * Y[r], 0));
  const iv = inv3(XtX); if (!iv) return null;
  const bta = iv.map((row) => row.reduce((s, v, j) => s + v * XtY[j], 0));
  const res = Y.map((y, r) => y - X[r].reduce((s, x, j) => s + x * bta[j], 0));
  const ssr = res.reduce((s, e) => s + e * e, 0), df = k - 3;
  const yM = Y.reduce((a, b) => a + b, 0) / k, sst = Y.reduce((s, y) => s + (y - yM) ** 2, 0);
  const s2 = df > 0 ? ssr / df : null;
  const se = (j) => (s2 != null ? Math.sqrt(Math.max(s2 * iv[j][j], 0)) : null);
  const v = bta[2], drift = bta[1] * S;
  const tc = tcrit(df);
  return { n: k, v, b0: bta[0], b1: bta[1], seV: se(2), vLo: tc && se(2) != null ? v - tc * se(2) : null, vHi: tc && se(2) != null ? v + tc * se(2) : null, drift, seDrift: se(1) != null ? se(1) * S : null, r2: sst > 0 ? 1 - ssr / sst : null, df };
}

// ---------- scale slopes (cost curves) ----------
// A cost line's slope is the multiplier on its unit cost each time the volume driver doubles:
//   ln(unit cost) = a + b ln(driver),  slope = 2^b,  cost(x) = cost(x0) * (x/x0)^log2(slope)
// With public data, revenue stands in for volume, so unit cost = cost / revenue. Each P&L cost line
// (cost of revenue, R&D, SG&A, other operating costs) gets its own slope. A slope below 100% means
// scale economies: the line shrinks as a share of revenue as the company grows.
// Trends are log-linear least squares; a series with an inflection is fitted on the period after the
// break (split_trend), since a change in perimeter (disposals, refranchising) breaks the curve.
function logTrendCagr(vals) {
  if (vals.length < 2 || vals.some((v) => !(v > 0))) return null;
  const n = vals.length, xb = (n - 1) / 2, ys = vals.map(Math.log), yb = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0; ys.forEach((y, x) => { sxy += (x - xb) * (y - yb); sxx += (x - xb) ** 2; });
  return Math.exp(sxy / sxx) - 1;
}
function logSse(vals) {
  const n = vals.length, xb = (n - 1) / 2, ys = vals.map(Math.log), yb = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0; ys.forEach((y, x) => { sxy += (x - xb) * (y - yb); sxx += (x - xb) ** 2; });
  const b = sxy / sxx, a = yb - b * xb;
  return ys.reduce((s, y, x) => s + (y - (a + b * x)) ** 2, 0);
}
function splitTrend(vals, minSeg = 4) {
  if (vals.some((v) => !(v > 0)) || vals.length < 2 * minSeg - 1) return null;
  let best = null;
  for (let b = minSeg - 1; b <= vals.length - minSeg; b++) {
    const sse = logSse(vals.slice(0, b + 1)) + logSse(vals.slice(b));
    if (!best || sse < best.sse) best = { sse, b };
  }
  const whole = logSse(vals);
  return { breakIndex: best.b, before: logTrendCagr(vals.slice(0, best.b + 1)), after: logTrendCagr(vals.slice(best.b)), sseRatio: whole > 0 ? best.sse / whole : 1 };
}
const COST_LINES = [
  { key: "cogs", label: "Cost of revenue", get: (c) => n(c.i?.costOfRevenue) },
  { key: "rd", label: "R&D", get: (c) => n(c.i?.researchAndDevelopmentExpenses) },
  { key: "sga", label: "SG&A", get: (c) => n(c.i?.sellingGeneralAndAdministrativeExpenses) },
  { key: "oth", label: "Other operating costs", get: (c) => { const op = n(c.i?.operatingExpenses); if (!isNum(op)) return null; return op - (n(c.i?.researchAndDevelopmentExpenses) ?? 0) - (n(c.i?.sellingGeneralAndAdministrativeExpenses) ?? 0); } },
];
function fitLogLog(pts) {
  const k = pts.length; if (k < 4) return null;
  const xs = pts.map((p) => Math.log(p.drv)), ys = pts.map((p) => Math.log(p.unit));
  const xb = xs.reduce((a, b) => a + b, 0) / k, yb = ys.reduce((a, b) => a + b, 0) / k;
  let sxx = 0, sxy = 0; xs.forEach((x, i) => { sxx += (x - xb) ** 2; sxy += (x - xb) * (ys[i] - yb); });
  if (!(sxx > 0)) return null;
  const b = sxy / sxx, a = yb - b * xb;
  const res = ys.map((y, i) => y - a - b * xs[i]);
  const ssr = res.reduce((s, e) => s + e * e, 0), sst = ys.reduce((s, y) => s + (y - yb) ** 2, 0);
  const se = k > 2 ? Math.sqrt(ssr / (k - 2) / sxx) : null, tc = tcrit(k - 2);
  return { n: k, a, b, slope: Math.pow(2, b), r2: sst > 0 ? 1 - ssr / sst : null, se, slopeLo: se && tc ? Math.pow(2, b - tc * se) : null, slopeHi: se && tc ? Math.pow(2, b + tc * se) : null };
}
function scaleSlopes(m, nYears, robust, afterBreak) {
  const last = m.curFY - 1;
  let years = [];
  for (let fy = last - nYears + 1; fy <= last; fy++) if (m.fyA[fy] && rev(m.fyA[fy]) > 0) years.push(fy);
  const revs = years.map((fy) => rev(m.fyA[fy]));
  const split = splitTrend(revs);
  // a break counts when two log-linear trends fit clearly better than one and the growth rates differ
  const brk = split && split.sseRatio < 0.5 && Math.abs(split.after - split.before) > 0.04 ? { fy: years[split.breakIndex], before: split.before, after: split.after } : null;
  const afterYears = brk ? years.filter((fy) => fy >= brk.fy) : years;
  const usedBreak = !!(afterBreak && brk && afterYears.length >= 6);
  if (usedBreak) years = afterYears;
  const B = m.fyA[last];
  const lines = COST_LINES.map((L) => {
    const base = B ? L.get(B) : null;
    const all = years.map((fy) => { const c = m.fyA[fy], v = L.get(c), r = rev(c); return v > 0 && r > 0 ? { fy, drv: r, unit: v / r, cost: v } : null; }).filter(Boolean);
    let fit = fitLogLog(all), dropped = [];
    if (robust && fit) {
      const t = trimmed(all, fitLogLog, (f, p) => Math.log(p.unit) - f.a - f.b * Math.log(p.drv));
      fit = t.fit; dropped = t.dropped.map((p) => p.fy);
    }
    return { ...L, base, share: div(base, rev(B || {})), fit, pts: all, dropped, usable: !!fit && base > 0 && Math.abs(base) > 0.005 * (rev(B) || 0) };
  });
  return { lines, years, brk, usedBreak, cagr: logTrendCagr(revs) };
}

// ---------- driver model: P&L -> cash flow -> balance sheet ----------
const RECON = "Other / reconciling items";

function runModel(m, inp, opts) {
  const B = m.fyA[m.curFY - 1];
  if (!B || !B.b || !B.c || !isNum(rev(B))) return null;
  const fys = Array.from({ length: MODEL_YEARS }, (_, k) => m.curFY + k);
  const ov = inp.ov || {}, sc = inp.s || {};
  const D = {};
  const setD = (key, fy, v) => { D[key + "|" + fy] = v; };
  const I = (key, fy) => { const o = ov[key + "|" + fy]; return isNum(o) ? o : D[key + "|" + fy]; };
  const S = (key, def) => (isNum(sc[key]) ? sc[key] : def);
  const hist3 = (fy) => m.fyA[fy];
  const revB = rev(B), ebitB = ebit(B), daB = da(B) ?? 0;
  const cogsB = n(B.i.costOfRevenue) ?? revB - (n(B.i.grossProfit) ?? revB);
  const avg3 = (fn, lo, hi, dflt) => {
    const vs = [0, 1, 2].map((k) => hist3(B.fy - k)).filter(Boolean).map(fn).filter(isNum);
    return vs.length ? clamp(vs.reduce((a, b) => a + b, 0) / vs.length, lo, hi) : dflt;
  };

  // ----- revenue build -----
  const has = (f) => B[f] && Object.values(B[f]).filter(isNum).length > 1;
  let basis = inp.basis || (has("prod") ? "segment" : has("geo") ? "geo" : "total");
  if ((basis === "segment" && !has("prod")) || (basis === "geo" && !has("geo"))) basis = "total";
  const field = basis === "segment" ? "prod" : "geo";
  let names = basis === "total" ? ["Total revenue"] : Object.keys(B[field]).filter((k) => isNum(B[field][k]) && B[field][k] !== 0).sort((a, b) => B[field][b] - B[field][a]);
  const segSum = (c) => { const vs = Object.values(c?.[field] || {}).filter(isNum); return vs.length ? vs.reduce((a, b) => a + b, 0) : null; };
  const histLine = (name, c) => {
    if (!c) return null;
    if (basis === "total") return rev(c);
    if (name === RECON) return sub(rev(c), segSum(c));
    return n(c[field]?.[name]);
  };
  if (basis !== "total") { const r = sub(revB, segSum(B)); if (isNum(r) && Math.abs(r) > 0.005 * Math.abs(revB)) names.push(RECON); }

  const consRev = (fy) => rev(m.consFy[fy]);
  const consG = (fy) => growth(consRev(fy), fy === m.curFY ? revB : consRev(fy - 1));
  const lineCagr = (name) => {
    const a = histLine(name, B), b3 = histLine(name, hist3(B.fy - 3));
    return isNum(a) && isNum(b3) && a > 0 && b3 > 0 ? clamp(Math.pow(a / b3, 1 / 3) - 1, -0.3, 0.5) : null;
  };
  const up = inp.up || {};
  const lines = names.map((name) => ({ name, base: histLine(name, B), units: !!up[name] && name !== RECON, vals: {}, g: {}, unitsV: {}, asp: {} }));
  lines.forEach((L) => {
    let prev = L.base, prevU = ov["u0:" + L.name + "|" + B.fy], prevDg = null;
    fys.forEach((fy) => {
      // consensus growth while it exists, then carry the last year's default forward
      // consensus growth for every line (the total then matches consensus), carried forward after year 3
      const dg = consG(fy) ?? prevDg ?? (L.name === RECON ? 0 : lineCagr(L.name) ?? 0.04);
      prevDg = dg;
      setD("g:" + L.name, fy, dg); setD("ug:" + L.name, fy, dg); setD("pg:" + L.name, fy, 0);
      let g;
      if (L.units) {
        const ug = I("ug:" + L.name, fy), pg = I("pg:" + L.name, fy);
        g = (1 + ug) * (1 + pg) - 1;
        if (isNum(prevU)) { prevU = prevU * (1 + ug); L.unitsV[fy] = prevU; }
      } else g = I("g:" + L.name, fy);
      const v = isNum(prev) ? prev * (1 + g) : null;
      L.g[fy] = g; L.vals[fy] = v; prev = v;
      if (isNum(L.unitsV[fy])) L.asp[fy] = div(v, L.unitsV[fy]);
    });
    L.baseUnits = prevU !== undefined ? ov["u0:" + L.name + "|" + B.fy] : undefined;
  });
  const R = {}; fys.forEach((fy) => { R[fy] = lines.reduce((s, L) => s + (L.vals[fy] || 0), 0); });

  // ----- defaults for per-year drivers -----
  const gmB = div(n(B.i.grossProfit), revB) ?? div(revB - cogsB, revB);
  const taxB = (() => { const t = taxRate(B); return isNum(t) && t > 0 && t < 0.45 ? t : 0.21; })();
  const sbcB = div(n(B.c.stockBasedCompensation), revB) ?? 0;
  const capexPct = avg3((c) => div(-(capex(c) ?? NaN), rev(c)), 0, 0.6, 0.04);
  // a content-type business: D&A dwarfs capex and the cash spent on the amortized assets sits in operating cash flow
  const contOn = daB > 3 * Math.abs(capex(B) ?? 0) && contSpend(B) > 0.5 * daB;
  const contPct = contOn ? avg3((c) => div(contSpend(c), rev(c)), 0, 0.8, 0) : 0;
  // For a content business, D&A = k x the average of this year's and last year's spend (capex + content); k is
  // calibrated on the base year, so D&A follows spend smoothly instead of running off a declining balance
  const spendOf = (c) => Math.abs(capex(c) ?? 0) + contSpend(c);
  const spendB = spendOf(B), spendB1 = m.fyA[B.fy - 1] ? spendOf(m.fyA[B.fy - 1]) : null;
  const contK = contOn && spendB > 0 ? clamp(daB / (isNum(spendB1) && spendB1 > 0 ? 0.5 * spendB + 0.5 * spendB1 : spendB), 0.6, 1.4) : null;
  const niB = n(B.i.netIncome), fcfB = fcf(B);
  const payB = isNum(niB) && niB > 0 && isNum(divPaid(B)) ? clamp(divPaid(B) / niB, 0, 1.5) : 0;
  const bbB = isNum(fcfB) && fcfB > 0 && isNum(buyback(B)) ? clamp(buyback(B) / fcfB, 0, 1.5) : 0;
  const ar0 = ar(B) ?? 0, inv0 = n(B.b.inventory) ?? 0, ap0 = n(B.b.accountPayables) ?? 0, dr0 = defRev(B) ?? 0;
  const dso0 = div(ar0, revB) * 365, dio0 = cogsB > 0 ? (inv0 / cogsB) * 365 : 0, dpo0 = cogsB > 0 ? (ap0 / cogsB) * 365 : 0, drp0 = div(dr0, revB) ?? 0;
  const intExpB = n(B.i.interestExpense) ?? 0, intIncB = n(B.i.interestIncome) ?? 0;
  const othB = (n(B.i.incomeBeforeTax) ?? ebitB) - ebitB + intExpB - intIncB;
  const histIncr = (() => { const h = hist3(B.fy - 3); const r = h ? div(sub(ebitB, ebit(h)), sub(revB, rev(h))) : null; return isNum(r) ? clamp(r, -0.5, 0.9) : div(ebitB, revB); })();
  // incremental margin that reproduces consensus EBIT exactly (unclamped)
  const consIncr = (fy) => {
    const ce = ebit(m.consFy[fy] || {}), pe = fy === m.curFY ? ebitB : ebit(m.consFy[fy - 1] || {});
    const dr = sub(consRev(fy), fy === m.curFY ? revB : consRev(fy - 1));
    return isNum(dr) && Math.abs(dr) > 0.001 * Math.abs(revB) ? div(sub(ce, pe), dr) : null;
  };
  const consYears = fys.filter((fy) => isNum(ebit(m.consFy[fy] || {})) && isNum(consRev(fy)));
  const lastConsFy = consYears.length ? Math.max(...consYears) : null;
  const lastConsMargin = lastConsFy ? ebit(m.consFy[lastConsFy]) / consRev(lastConsFy) : null;
  fys.forEach((fy) => {
    setD("gm", fy, gmB); setD("tax", fy, taxB); setD("sbc", fy, sbcB); setD("capex", fy, capexPct); setD("cont", fy, contPct);
    setD("pay", fy, payB); setD("bb", fy, bbB); setD("acq", fy, 0); setD("dIss", fy, 0); setD("oth", fy, 0);
    setD("dso", fy, dso0); setD("dio", fy, dio0); setD("dpo", fy, dpo0); setD("dr", fy, drp0);
    // after consensus ends, an incremental margin equal to the last consensus EBIT margin keeps that margin
    setD("incr", fy, consIncr(fy) ?? (lastConsFy && fy > lastConsFy ? lastConsMargin : null) ?? D["incr|" + (fy - 1)] ?? histIncr);
    // consensus EBIT margin, carried forward after the last consensus year
    const cm = isNum(ebit(m.consFy[fy] || {})) && consRev(fy) > 0 ? ebit(m.consFy[fy]) / consRev(fy) : null;
    setD("em", fy, cm ?? D["em|" + (fy - 1)] ?? div(ebitB, revB));
  });

  // ----- scalar settings -----
  const ppeB = n(B.b.propertyPlantEquipmentNet) ?? 0, intgB = n(B.b.intangibleAssets) ?? 0;
  const depBase = ppeB + Math.max(intgB, 0);
  // Existing assets run off at the current D&A rate (declining balance); new capex is depreciated
  // straight-line over a useful life that defaults to the life implied by that rate.
  const rateDflt = depBase > 0 && daB > 0 ? clamp(daB / depBase, 0.02, 0.6) : 0.1;
  const scal = {
    life: S("life", clamp(Math.round(1 / rateDflt), 3, 40)),
    rem: S("rem", rateDflt),
    kd: S("kd", isNum(debt(B)) && debt(B) > 0 ? clamp(intExpB / debt(B), 0, 0.15) : 0.05),
    ky: S("ky", isNum(cashST(B)) && cashST(B) > 0 ? clamp(intIncB / cashST(B), 0, 0.08) : 0.03),
    px: S("px", isNum(opts?.price) && opts.price > 0 ? opts.price : (div(niB, n(B.i.weightedAverageShsOutDil)) ?? 1) * 20),
  };
  const dflt = { life: clamp(Math.round(1 / rateDflt), 3, 40), rem: rateDflt, kd: isNum(debt(B)) && debt(B) > 0 ? clamp(intExpB / debt(B), 0, 0.15) : 0.05, ky: isNum(cashST(B)) && cashST(B) > 0 ? clamp(intIncB / cashST(B), 0, 0.08) : 0.03, px: isNum(opts?.price) && opts.price > 0 ? opts.price : null };

  // ----- cost method -----
  const regCfg = { n: 10, icpt: false, robust: true, afterBreak: true, ...(inp.reg || {}) };
  const reg = regressIncr(m, regCfg.n, regCfg.icpt, regCfg.robust);
  // Scale slopes: each cost line follows its own scale curve against revenue
  const sl = scaleSlopes(m, regCfg.n, regCfg.robust, regCfg.afterBreak);
  reg.slopes = sl;
  const slopeOk = (L) => L.usable && L.fit && L.fit.r2 >= 0.3;
  sl.lines.forEach((L) => { L.dflt = slopeOk(L) ? clamp(L.fit.slope, 0.6, 1.2) : 1; L.reliable = slopeOk(L); });
  const costLines = sl.lines.filter((L) => isNum(L.base) && L.base !== 0);
  const slopeR2 = (() => { const ls = costLines.filter((L) => L.fit && L.base > 0); const w = ls.reduce((a, L) => a + L.base, 0); return w > 0 ? ls.reduce((a, L) => a + L.base * Math.max(L.fit.r2 ?? 0, 0), 0) / w : 0; })();
  const reconB = revB - costLines.reduce((a, L) => a + L.base, 0) - ebitB; // items in neither cost lines nor EBIT
  const hasCogsLine = costLines.some((L) => L.key === "cogs");
  fys.forEach((fy) => costLines.forEach((L) => setD("sl:" + L.key, fy, L.dflt)));
  const slopeCost = {}; // line -> fy -> cost
  costLines.forEach((L) => {
    slopeCost[L.key] = {};
    let pc = L.base, pr = revB;
    fys.forEach((fy) => {
      const r = R[fy], s = I("sl:" + L.key, fy);
      const unit = (pc / pr) * Math.pow(r / pr, Math.log2(s > 0 ? s : 1));
      slopeCost[L.key][fy] = unit * r; pc = unit * r; pr = r;
    });
  });
  const cost = costRegress(m, regCfg.n, regCfg.robust);
  reg.cost = cost;

  const histIncrEbitda = (() => { const h = hist3(B.fy - 3); const r = h ? div(sub(sum(ebitB, daB), ebitda(h)), sub(revB, rev(h))) : null; return isNum(r) ? r : null; })();
  const cashCostB = revB - ebitB - daB;
  // fixed + variable defaults come from the cost-structure regression when it gives a sensible split
  const costOk = cost.valid && cost.fit && cost.fit.v >= 0.05 && cost.fit.v <= 0.98;
  // Method follows the cost structure unless the user picked one: high fixed costs -> fixed + variable
  // (incremental margins swing with growth); mostly variable -> regression slope; unclear -> consensus-led
  const slopesUsable = hasCogsLine && slopeR2 >= 0.5;
  // Defaults follow consensus whenever it covers EBIT; otherwise the cost structure picks the method
  const costSuggest = slopesUsable ? "regress" : costOk && cost.profile !== "low" ? "fixvar" : "incr";
  const consAnchored = consYears.includes(fys[0]);
  const autoMethod = consAnchored ? "cons" : costSuggest;
  let method = ["cons", "incr", "regress", "fixvar", "segment"].includes(inp.costMethod) ? inp.costMethod : autoMethod;
  if (method === "regress" && !hasCogsLine) method = "incr";
  // under the slope method the gross margin default follows the cost-of-revenue curve
  if (method === "regress") fys.forEach((fy) => { const c = slopeCost.cogs?.[fy]; if (isNum(c)) setD("gm", fy, 1 - c / R[fy]); });
  const vEst = costOk ? cost.fit.v : null;
  fys.forEach((fy) => {
    setD("var", fy, costOk ? cost.fit.v : clamp(1 - (histIncrEbitda ?? 0.35), 0.2, 0.95));
    // fixed costs grow at the historical rate, capped at ~inflation: growth above that was discretionary
    // expansion (headcount, stores, marketing) that management can and often does stop
    setD("fg", fy, costOk && isNum(cost.fixedGrowth) ? Math.min(cost.fixedGrowth, FIXED_GROWTH_CAP) : FIXED_GROWTH_CAP);
  });
  const segE0 = {}; lines.forEach((L) => { const v = ov["se0:" + L.name + "|" + B.fy]; segE0[L.name] = isNum(v) ? v : null; });
  lines.forEach((L) => fys.forEach((fy) => setD("si:" + L.name, fy, isNum(segE0[L.name]) && isNum(L.base) && L.base ? segE0[L.name] / L.base : div(ebitB, revB))));
  fys.forEach((fy) => setD("ua", fy, 0));

  // ----- run the years -----
  const out = {};
  let prev = { spend: spendB, rev: revB, ebit: ebitB, cash: cashST(B) ?? 0, ar: ar0, inv: inv0, ap: ap0, dr: dr0, debt: debt(B) ?? 0, depBase, gw: n(B.b.goodwill) ?? Math.max((n(B.b.goodwillAndIntangibleAssets) ?? 0) - intgB, 0), shares: n(B.i.weightedAverageShsOutDil), fixed: null, segE: { ...segE0 }, ua: null };
  const otherCA = (n(B.b.totalCurrentAssets) ?? 0) - (cashST(B) ?? 0) - ar0 - inv0;
  const otherNCA = (n(B.b.totalAssets) ?? 0) - (n(B.b.totalCurrentAssets) ?? 0) - depBase - prev.gw;
  const otherL = (n(B.b.totalLiabilities) ?? 0) - ap0 - dr0 - (debt(B) ?? 0);
  let equity = (n(B.b.totalAssets) ?? 0) - (n(B.b.totalLiabilities) ?? 0);
  const ppeShare = depBase > 0 ? ppeB / depBase : 1;
  let existLeft = depBase;
  const vint = []; // new capex vintages
  // Fixed-cost base uses the first forecast year's variable-cost ratio
  const var0 = I("var", fys[0]);
  let fixed0 = cashCostB - var0 * revB;
  const fixedNeg = fixed0 < 0;
  if (fixedNeg) fixed0 = 0;
  const uaBase = isNum(ebitB) ? ebitB - lines.reduce((s, L) => s + (isNum(segE0[L.name]) ? segE0[L.name] : (isNum(L.base) ? L.base * div(ebitB, revB) : 0)), 0) : 0;
  prev.fixed = fixed0; prev.ua = uaBase;
  lines.forEach((L) => { if (!isNum(prev.segE[L.name])) prev.segE[L.name] = isNum(L.base) ? L.base * div(ebitB, revB) : 0; });

  fys.forEach((fy) => {
    const r = R[fy], dRev = r - prev.rev;
    const gm = I("gm", fy), cogs = r * (1 - gm);
    const capexV = I("capex", fy) * r, contV = Math.max(I("cont", fy) ?? 0, 0) * r;
    // D&A: existing asset base runs off straight-line; each capex vintage depreciates over its useful life (half-year in year one)
    let daExist, daNew = 0;
    if (isNum(contK)) { daExist = contK * 0.5 * prev.spend; daNew = contK * 0.5 * (capexV + contV); }
    else {
      daExist = Math.max(existLeft, 0) * scal.rem; existLeft -= daExist;
      vint.push({ amt: capexV + contV, left: capexV + contV, first: true });
      vint.forEach((v) => { const d = Math.min(v.left, (v.amt / scal.life) * (v.first ? 0.5 : 1)); v.left -= d; v.first = false; daNew += d; });
    }
    const daV = daExist + daNew;

    let ebitV, fixedV = null, varV = null, segE = null, uaV = null;
    if (method === "cons") ebitV = I("em", fy) * r;
    else if (method === "incr") ebitV = prev.ebit + I("incr", fy) * dRev;
    else if (method === "regress") {
      // revenue less cost of revenue (from the gross margin, which defaults to its slope curve) and the other lines' curves
      const opLines = costLines.filter((L) => L.key !== "cogs").reduce((a, L) => a + slopeCost[L.key][fy], 0);
      ebitV = r - cogs - opLines - reconB * (r / revB);
    }
    else if (method === "fixvar") {
      fixedV = prev.fixed * (1 + I("fg", fy)); varV = r * I("var", fy);
      ebitV = r - varV - fixedV - daV;
    } else {
      segE = {};
      lines.forEach((L) => { const dl = sub(L.vals[fy], fy === fys[0] ? L.base : L.vals[fy - 1]) ?? 0; segE[L.name] = prev.segE[L.name] + I("si:" + L.name, fy) * dl; });
      uaV = prev.ua * (1 + I("ua", fy));
      ebitV = Object.values(segE).reduce((a, b) => a + b, 0) + uaV;
    }
    const intExp = scal.kd * prev.debt, intInc = scal.ky * Math.max(prev.cash, 0);
    // default non-operating items close the gap to consensus net income (at consensus EBIT and default tax),
    // so net income matches consensus until EBIT, tax or this line is changed
    const cy = m.consFy[fy], niC = n(cy?.i?.netIncome), ebitC = ebit(cy || {});
    const tD = D["tax|" + fy];
    // Consensus net income and consensus EPS can come from different analyst sets and imply an implausible share
    // count. Then the model keeps its share count and matches consensus EPS (the wider set); the gap to consensus
    // net income goes into other non-operating items.
    const epsC = n(cy?.i?.epsDiluted), shC = isNum(niC) && isNum(epsC) && epsC > 0 ? niC / epsC : null;
    const shConflict = isNum(shC) && prev.shares > 0 && Math.abs(shC / prev.shares - 1) >= SH_BAND;
    const shUser = n(ov["sh|" + fy]);
    const niTarget = shConflict ? epsC * (isNum(shUser) ? shUser : prev.shares) : niC;
    if (isNum(niTarget) && isNum(ebitC) && tD < 0.95) {
      setD("oth", fy, niTarget / (1 - tD) - (ebitC - intExp + intInc));
      // what the item would be on consensus net income: carried after consensus ends, so an EPS/NI conflict is not
      setD("othNI", fy, isNum(niC) ? niC / (1 - tD) - (ebitC - intExp + intInc) : D["oth|" + fy]);
    } else if (lastConsFy && fy > lastConsFy) { setD("oth", fy, D["othNI|" + (fy - 1)] ?? D["oth|" + (fy - 1)] ?? 0); setD("othNI", fy, D["oth|" + fy]); }
    const pretax = ebitV - intExp + intInc + I("oth", fy);
    const taxV = pretax * I("tax", fy);
    const ni = pretax - taxV;
    const sbc = I("sbc", fy) * r;
    const arV = (I("dso", fy) / 365) * r, invV = (I("dio", fy) / 365) * cogs, apV = (I("dpo", fy) / 365) * cogs, drV = I("dr", fy) * r;
    const dNwc = (arV + invV - apV - drV) - (prev.ar + prev.inv - prev.ap - prev.dr);
    const cfoV = ni + daV + sbc - dNwc - contV;
    const fcfV = cfoV - capexV;
    const divV = I("pay", fy) * Math.max(ni, 0);
    const bbV = I("bb", fy) * Math.max(fcfV, 0);
    const acqV = Math.abs(I("acq", fy)), dIss = I("dIss", fy);
    const cash = prev.cash + fcfV - acqV - divV - bbV + dIss;
    const debtV = prev.debt + dIss;
    const depBaseV = prev.depBase + capexV + contV - daV;
    const gwV = prev.gw + acqV;
    // Diluted shares: consensus share count (net income / EPS) while consensus lasts, so EPS matches it, when that
    // count is within SH_BAND of the prior year; on a conflict the prior count is kept (see above); afterwards stock
    // comp issues shares and buybacks retire them at the buyback price
    const mechEnd = isNum(prev.shares) ? prev.shares + (sbc - bbV) / scal.px : null;
    const shCok = isNum(shC) && !shConflict;
    setD("sh", fy, shCok ? shC : shConflict ? prev.shares : isNum(mechEnd) ? (prev.shares + mechEnd) / 2 : null);
    const sharesAvg = I("sh", fy);
    const fixedShares = shCok || shConflict || isNum(ov["sh|" + fy]);
    const sharesEnd = fixedShares ? sharesAvg : mechEnd;
    equity = equity + ni - divV - bbV + sbc;
    const tca = cash + arV + invV + otherCA;
    const ta = tca + depBaseV + gwV + otherNCA;
    const tl = apV + drV + debtV + otherL;
    out[fy] = {
      fy, rev: r, gm, cogs, ebit: ebitV, da: daV, daExist, daNew, capex: capexV, cont: contV, shC, shCok, shConflict, shPrev: prev.shares, niCons: niC, intExp, intInc, pretax, tax: taxV, ni, sbc, dNwc, cfo: cfoV, fcf: fcfV, div: divV, bb: bbV, acq: acqV, dIss,
      cashCost: r - ebitV - daV, varC: method === "fixvar" ? varV : isNum(vEst) ? vEst * r : null,
      fixC: method === "fixvar" ? fixedV : isNum(vEst) ? r - ebitV - daV - vEst * r : null,
      cash, debt: debtV, equity, shares: sharesAvg, sharesEnd, eps: div(ni, sharesAvg), fixed: fixedV, var: varV, segE, ua: uaV, check: ta - tl - equity,
      ctx: {
        ...FY_CTX, kind: "E", model: true, fy, label: "FY" + fy,
        i: { revenue: r, costOfRevenue: cogs, grossProfit: r - cogs, operatingExpenses: r - cogs - ebitV, operatingIncome: ebitV, depreciationAndAmortization: daV, interestExpense: intExp, interestIncome: intInc, incomeBeforeTax: pretax, incomeTaxExpense: taxV, netIncome: ni, weightedAverageShsOutDil: sharesAvg, epsDiluted: div(ni, sharesAvg) },
        c: { netIncome: ni, depreciationAndAmortization: daV, stockBasedCompensation: sbc, changeInWorkingCapital: -dNwc, netCashProvidedByOperatingActivities: cfoV, capitalExpenditure: -capexV, freeCashFlow: fcfV, acquisitionsNet: -acqV, commonStockRepurchased: -bbV, netDividendsPaid: -divV, netDebtIssuance: dIss, _daExist: daExist, _daNew: daNew, _content: contV },
        b: { cashAndShortTermInvestments: cash, accountsReceivables: arV, inventory: invV, totalCurrentAssets: tca, propertyPlantEquipmentNet: depBaseV * ppeShare, goodwillAndIntangibleAssets: gwV + depBaseV * (1 - ppeShare), totalAssets: ta, accountPayables: apV, deferredRevenue: drV, totalDebt: debtV, totalLiabilities: tl, totalStockholdersEquity: equity, _check: ta - tl - equity },
        [field]: basis === "total" ? undefined : Object.fromEntries(lines.filter((L) => L.name !== RECON).map((L) => [L.name, L.vals[fy]])),
      },
    };
    prev = { spend: capexV + contV, rev: r, ebit: ebitV, cash, ar: arV, inv: invV, ap: apV, dr: drV, debt: debtV, depBase: depBaseV, gw: gwV, shares: sharesEnd, fixed: fixedV ?? prev.fixed, segE: segE || prev.segE, ua: uaV ?? prev.ua };
  });
  // chain YoY: first model year compares with the last reported year
  let pc = B;
  fys.forEach((fy) => { out[fy].ctx.p = pc; pc = out[fy].ctx; });
  return { consAnchored, costSuggest, consFy: m.consFy, fys, B, basis, contOn, contK, field, lines, R, out, I, D, ov, method, slopeCost, costLines, slopeR2, slopesUsable, reconB, autoMethod, methodAuto: !["cons", "incr", "regress", "fixvar", "segment"].includes(inp.costMethod), vEst, reg, regCfg, scal, dflt, fixed0, fixedNeg, uaBase, segE0, histLine, consRev };
}

// ---------- DCF (Damodaran-style FCFF) ----------
// Damodaran, "Investment Valuation" / "The Little Book of Valuation": cost of capital from CAPM with a
// mature-market ERP plus country risk premium; cost of debt from a synthetic rating on interest coverage;
// high-growth years from the operating model, a fade to stable growth, and a terminal value where
// reinvestment = g / ROIC. Stock-based compensation is treated as an operating expense (not added back).
const RATING_TABLE = [ // large non-financial firms; coverage floor -> rating, default spread (approximate)
  [8.5, "AAA", 0.0059], [6.5, "AA", 0.0078], [5.5, "A+", 0.0098], [4.25, "A", 0.0108], [3, "A-", 0.0122],
  [2.5, "BBB", 0.0156], [2.25, "BB+", 0.02], [2, "BB", 0.024], [1.75, "B+", 0.0291], [1.5, "B", 0.0351],
  [1.25, "B-", 0.0421], [0.8, "CCC", 0.0515], [0.65, "CC", 0.082], [0.2, "C", 0.0864], [-Infinity, "D", 0.1134],
];
function syntheticRating(coverage) {
  if (!isNum(coverage)) return { rating: "AAA", spread: RATING_TABLE[0][2] };
  const row = RATING_TABLE.find((r) => coverage > r[0]);
  return { rating: row[1], spread: row[2] };
}

function dcfDefaults(mdl, mkt) {
  const B = mdl.B;
  const intExp = n(B.i.interestExpense) ?? 0;
  const cov = intExp > 0 ? div(ebit(B), intExp) : null;
  const syn = syntheticRating(cov);
  const last = mdl.out[mdl.fys[mdl.fys.length - 1]];
  const rf = isNum(mkt.rf) ? mkt.rf : 0.045;
  return {
    rf, beta: isNum(mkt.beta) && mkt.beta > 0 ? +mkt.beta.toFixed(2) : 1, erp: isNum(mkt.erp) ? mkt.erp : 0.0423, crp: isNum(mkt.crp) ? mkt.crp : 0,
    kdPre: rf + syn.spread, spread: syn.spread, rating: syn.rating, coverage: cov, tm: 0.25,
    g: Math.min(0.025, rf), mT: div(last.ebit, last.rev) ?? 0.1, betaT: 1, roicT: null, s2c: null, wacc: null, lti: 1, mid: 0, lease: 0,
  };
}

// basis "cons": years 1-3 use consensus revenue and EBIT margin (later years carry year 3 forward);
// consensus has no capex or working capital, so reinvestment = revenue added / sales-to-capital.
function runDcf(mdl, mkt, setIn, shift, basis) {
  const d0 = dcfDefaults(mdl, mkt);
  const s = { ...d0 };
  Object.keys(setIn || {}).forEach((k) => { if (isNum(setIn[k])) s[k] = setIn[k]; });
  // defaults that follow the risk-free rate also follow an overridden one
  if (!isNum(setIn?.kdPre)) s.kdPre = s.rf + d0.spread;
  if (!isNum(setIn?.g)) s.g = Math.min(0.025, s.rf);
  // EBIT and FCFF are after lease costs, so lease liabilities are left out of debt unless the user counts them
  // (Damodaran's alternative: keep them as debt and add the interest part of lease cost back to EBIT)
  const B = mdl.B, revB = rev(B);
  // the box only acts when the bridge's balance sheet has leases in its debt
  const L = mkt.lease ?? 0, leaseOn = !!s.lease && L > 0;
  const leaseX = leaseOn ? 0 : L;
  const E = mkt.mcap, Dv = (mkt.debt ?? 0) - leaseX;
  // counted leases: lease debt grows with revenue, its interest (lease x pre-tax cost of debt) is added back to EBIT
  // and its growth is reinvestment
  const lam = leaseOn && revB > 0 ? (L * s.kdPre) / revB : 0;
  const leaseInt = (r) => lam * r;
  const leaseCap = (r, pr) => (leaseOn && revB > 0 ? (L * (r - pr)) / revB : 0);
  const ke = s.rf + s.beta * (s.erp + s.crp);
  const kdAT = s.kdPre * (1 - s.tm);
  const wE = isNum(E) && E + Dv > 0 ? E / (E + Dv) : 1;
  const waccCalc = wE * ke + (1 - wE) * kdAT;
  let wacc = isNum(s.wacc) ? s.wacc : waccCalc;
  const keT = s.rf + s.betaT * (s.erp + s.crp);
  let waccT = Math.min(wE * keT + (1 - wE) * kdAT, wacc);
  if (isNum(s.wacc)) waccT = Math.min(waccT, s.wacc);
  wacc += shift?.w || 0; waccT += shift?.w || 0;
  const g = s.g + (shift?.g || 0);

  // invested capital at the model's starting balance sheet (fiscal year-end), on the same basis as the bridge:
  // debt (leases only if counted) + equity + minority - cash - non-operating investments
  const bB = B.b || {};
  const icRaw = (debt(B) ?? 0) - leaseInDebt(B) + (leaseOn ? leaseInDebt(B) || n(bB.capitalLeaseObligations) || 0 : 0) + (n(bB.totalStockholdersEquity) ?? 0) + (n(bB.minorityInterest) ?? 0) - (cashST(B) ?? 0) - (s.lti ? n(bB.longTermInvestments) ?? 0 : 0);
  const icB = icRaw > 0 ? icRaw : null;
  const reinvOf = (o, pr) => o.capex + (o.cont || 0) - o.da + o.dNwc + o.acq + leaseCap(o.rev, pr);
  // sales-to-capital: revenue added per $1 reinvested in our forecast's later years (years 3-5), where the
  // consensus-driven early years and one-off working-capital swings matter least; then all five years; then revenue / IC
  const ratio = (fysSel) => {
    let dr = 0, ri = 0;
    fysSel.forEach((fy) => { const o = mdl.out[fy], pr = fy === mdl.fys[0] ? revB : mdl.out[fy - 1].rev; dr += o.rev - pr; ri += reinvOf(o, pr); });
    return dr > 0 && ri > 0 ? clamp(dr / ri, 0.3, 8) : null;
  };
  let s2cDflt = ratio(mdl.fys.slice(2)), s2cSrc = "our forecast, years 3–5";
  if (!isNum(s2cDflt)) { s2cDflt = ratio(mdl.fys); s2cSrc = "our forecast, years 1–5"; }
  const s2cFromModel = isNum(s2cDflt);
  if (!s2cFromModel) { s2cDflt = clamp(div(revB, icB) ?? 1.5, 0.3, 8); s2cSrc = "revenue ÷ invested capital, since our forecast's reinvestment is not positive"; }
  const s2c = isNum(s.s2c) ? s.s2c : s2cDflt;

  const rows = [];
  let prevRev = revB;
  const useCons = basis === "cons";
  let cg = null, cm = null; // last consensus growth and margin, carried forward
  mdl.fys.forEach((fy, k) => {
    const o = mdl.out[fy];
    const t = mdl.I("tax", fy);
    let r, e, reinv, label;
    if (useCons) {
      const c = mdl.consFy?.[fy], cr = rev(c || {}), ce = ebit(c || {});
      if (isNum(cr) && isNum(ce) && cr > 0) { cg = growth(cr, prevRev); cm = ce / cr; r = cr; e = ce; label = "FY" + fy + "C"; }
      else { r = prevRev * (1 + (cg ?? growth(o.rev, prevRev) ?? 0)); e = r * (cm ?? div(o.ebit, o.rev)); label = "FY" + fy + "C*"; }
      reinv = (r - prevRev) / s2c;
    } else {
      r = o.rev; e = o.ebit; reinv = reinvOf(o, prevRev); label = "FY" + fy + "E";
    }
    const li = leaseInt(r);
    e += li;
    const nopat = e * (1 - t);
    // bridge from the model's free cash flow (CFO - capex) to FCFF, for the model basis
    const recon = useCons ? null : { fcf: o.fcf, sbc: o.sbc, nonop: (o.pretax - o.ebit) * (1 - t), acq: o.acq, lease: li * (1 - t), leaseCap: leaseCap(r, prevRev) };
    const s2cK = useCons ? s2c : reinv > 0 ? (r - prevRev) / reinv : null;
    rows.push({ yr: k + 1, fy, label, rev: r, g: growth(r, prevRev), margin: div(e, r), ebit: e, tax: t, nopat, reinv, fcff: nopat - reinv, wacc, recon, s2c: s2cK, sbc: useCons ? I0(mdl, "sbc", fy) * r : o.sbc });
    prevRev = r;
  });
  // return on invested capital through year 5, from the fiscal year-end invested capital
  let ic = icB;
  rows.forEach((r) => { r.icBeg = ic; r.roic = isNum(ic) && ic > 0 ? r.nopat / ic : null; if (isNum(ic)) ic += r.reinv; });
  // Default terminal ROIC: halfway between the model's year-5 ROIC and the stable-period cost of capital
  // (excess returns fade but do not vanish); set it to WACC for Damodaran's no-moat case.
  // with no (or negative) capital but positive NOPAT, returns are as high as the cap allows, not zero excess
  const r5 = rows[4], roic5 = r5?.roic;
  const roicDflt = r5 && r5.nopat > 0 && !(r5.icBeg > 0) ? 0.4 : isNum(roic5) ? clamp((roic5 + waccT) / 2, waccT, 0.4) : waccT;
  const roicT = isNum(s.roicT) ? s.roicT : roicDflt;
  // sales-to-capital consistent with the terminal year: reinvestment g / ROIC on revenue growing at g
  const s2cT = s.mT + lam > 0 && s.tm < 1 && roicT > 0 ? clamp(roicT / ((s.mT + lam) * (1 - s.tm)), 0.3, 8) : s2c;
  const l5 = rows[rows.length - 1];
  const g5 = l5.g ?? g, m5 = div(l5.ebit - leaseInt(l5.rev), l5.rev), t5 = l5.tax, sbc5 = div(l5.sbc, l5.rev) ?? 0;
  // fade mode: a typed ratio applies to all five years; by default sales-to-capital moves from our forecast's ratio to
  // the terminal-consistent one, so reinvestment does not jump at either end; when our forecast's reinvestment is not
  // positive, the reinvestment rate (reinvestment / NOPAT) moves from year 5's to the terminal g / ROIC instead
  const fadeMode = isNum(s.s2c) ? "user" : s2cFromModel || useCons ? "s2c" : "rate";
  const rr5 = div(l5.reinv, l5.nopat) ?? 0, rrT = roicT > 0 ? g / roicT : 0;
  for (let k = 6; k <= 10; k++) {
    const f = (k - 5) / 5;
    const gk = g5 + (g - g5) * f, mk = m5 + (s.mT - m5) * f, tk = t5 + (s.tm - t5) * f, wk = wacc + (waccT - wacc) * f;
    const r = prevRev * (1 + gk);
    const e = r * mk + leaseInt(r), nopat = e * (1 - tk);
    let reinv, sk;
    if (fadeMode === "rate") { reinv = nopat * (rr5 + (rrT - rr5) * f); sk = reinv > 0 ? (r - prevRev) / reinv : null; }
    else { sk = fadeMode === "user" ? s.s2c : s2c + (s2cT - s2c) * f; reinv = (r - prevRev) / sk; }
    rows.push({ yr: k, label: "Year " + k, rev: r, g: gk, margin: div(e, r), ebit: e, tax: tk, nopat, reinv, fcff: nopat - reinv, wacc: wk, fade: true, sbc: sbc5 * r, s2c: sk });
    prevRev = r;
  }
  rows.slice(5).forEach((r) => { r.icBeg = ic; r.roic = isNum(ic) && ic > 0 ? r.nopat / ic : null; if (isNum(ic)) ic += r.reinv; });
  // Year 1 is the current fiscal year. The equity bridge uses the latest balance sheet, which already holds the
  // cash flow of the quarters reported since the last fiscal year-end, so those are taken out of year 1.
  const ytd = mkt.ytd;
  let ytdF = 0;
  if (ytd && ytd.n > 0) {
    const t1 = rows[0].tax;
    // acquisitions only up to what the year-1 forecast assumes (0 by default), so a deal already paid is not added back
    const acqY = Math.max(0, Math.min(ytd.acq, Math.max(0, mdl.out[mdl.fys[0]].acq || 0)));
    ytdF = (ytd.ebit + leaseInt(ytd.rev ?? 0)) * (1 - t1) - (ytd.capex + (mdl.contOn || mdl.out[mdl.fys[0]].cont > 0 ? ytd.cont : 0) - ytd.da + ytd.dNwc + acqY);
  }
  rows.forEach((r, ix) => { r.ytd = ix === 0 ? ytdF : 0; r.cf = r.fcff - r.ytd; });
  // discounting from today: year k ends k - elapsed years from now (elapsed = time since the last fiscal year-end)
  const elapsed = Math.max(mkt.elapsed ?? 0, 0);
  let df = 1, tPrev = 0;
  rows.forEach((r, ix) => {
    const tk = Math.max(0, ix + 1 - elapsed), len = tk - tPrev; tPrev = tk;
    df = df / Math.pow(1 + r.wacc, len);
    r.t = tk; r.len = len;
    r.df = s.mid ? df * Math.pow(1 + r.wacc, len / 2) : df;
    r.pv = r.cf * r.df;
  });
  const last = rows[rows.length - 1];
  const revT = last.rev * (1 + g), ebitT = revT * s.mT + leaseInt(revT), nopatT = ebitT * (1 - s.tm);
  const reinvRateT = roicT > 0 ? g / roicT : 0;
  const fcffT = nopatT * (1 - reinvRateT);
  const tv = waccT > g ? fcffT / (waccT - g) : null;
  const pvTv = isNum(tv) ? tv * last.df : null;
  const pvSum = rows.reduce((a, r) => a + r.pv, 0);
  const ev = isNum(pvTv) ? pvSum + pvTv : null;
  const equity = isNum(ev) ? ev - Dv - (mkt.minority ?? 0) + (mkt.cash ?? 0) + (s.lti ? mkt.lti ?? 0 : 0) : null;
  const perShare = div(equity, mkt.shares);
  // what treating stock comp as a cost is worth: PV of the SBC stream on the same timing, per share
  const pvSbc = rows.reduce((a, r) => a + (r.sbc || 0) * r.df, 0) - (ytd && ytd.n > 0 ? (ytd.sbc || 0) * rows[0].df : 0) + (waccT > g ? (sbc5 * revT) / (waccT - g) * last.df : 0);
  return {
    basis: useCons ? "cons" : "model", s, d0, ke, keT, kdAT, wE, waccCalc, wacc, waccT, g, roicT, roicDflt, s2c, s2cDflt, s2cSrc, s2cT, fadeMode, rr5, rrT, rows,
    terminal: { rev: revT, ebit: ebitT, nopat: nopatT, reinvRate: reinvRateT, fcff: fcffT, tv, pvTv, s2c: nopatT * reinvRateT > 0 ? (revT - last.rev) / (nopatT * reinvRateT) : null },
    pvSum, ev, equity, perShare, upside: isNum(perShare) && isNum(mkt.price) ? perShare / mkt.price - 1 : null,
    tvShare: div(pvTv, ev), debtUsed: Dv, leaseX, leaseOn, icB, ytd: ytd && ytd.n > 0 ? { ...ytd, fcff: ytdF } : null, elapsed,
    sbcPerShare: div(pvSbc, mkt.shares),
  };
}
const I0 = (mdl, k, fy) => mdl.I(k, fy) ?? 0;
// ENGINE END
