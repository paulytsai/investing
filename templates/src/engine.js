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

// ---------- building actual / consensus columns ----------
const yy = (fy) => String(fy).slice(-2);
const asc = (a) => (Array.isArray(a) ? a : []).filter((r) => r && r.fiscalYear != null && r.date).sort((x, y) => String(x.date).localeCompare(String(y.date)));
const byKey = (a) => { const m = {}; (Array.isArray(a) ? a : []).forEach((r) => { if (r && r.fiscalYear != null) m[(r.period || "FY") + "|" + r.fiscalYear] = r; }); return m; };
const META = new Set(["date", "symbol", "reportedCurrency", "cik", "filingDate", "acceptedDate", "fiscalYear", "period", "_nAnalysts"]);
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
const estToI = (e) => ({ revenue: n(e.revenueAvg), operatingIncome: n(e.ebitAvg), netIncome: n(e.netIncomeAvg), epsDiluted: n(e.epsAvg), sellingGeneralAndAdministrativeExpenses: n(e.sgaExpenseAvg), _ebitda: n(e.ebitdaAvg), _nAnalysts: n(e.numAnalystsEps) ?? n(e.numAnalystsRevenue) });
const FY_CTX = { A: 1, D: 365, type: "FY" }, Q_CTX = { A: 4, D: 91.25, type: "Q" }, H_CTX = { A: 2, D: 182.5, type: "H" };
const MODEL_YEARS = 5;
const CONS_YEARS = 3; // consensus shown (and used for default drivers) for the current year + 2

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
  const quarter = (q, fy) => qA["Q" + q + "|" + fy] || qE["Q" + q + "|" + fy] || { ...Q_CTX, kind: "C", label: "Q" + q + " FY" + yy(fy) };
  const cq = [1, 2, 3, 4].map((q) => quarter(q, curFY));
  const pq = [1, 2, 3, 4].map((q) => qA["Q" + q + "|" + (curFY - 1)] || null);
  cq.forEach((c, j) => { c.p = pq[j]; });
  const half = (qs, label) => ({
    ...H_CTX, label, kind: qs.every((c) => c && c.kind === "A") ? "A" : "C",
    i: sumRecs(qs.map((c) => c && c.i)), c: sumRecs(qs.map((c) => c && c.c)), b: qs[qs.length - 1]?.b,
    prod: sumSeg(qs.map((c) => c && c.prod)), geo: sumSeg(qs.map((c) => c && c.geo)),
  });
  const h1 = half(cq.slice(0, 2), "H1 FY" + yy(curFY)), h2 = half(cq.slice(2), "H2 FY" + yy(curFY));
  if (pq.every(Boolean)) { h1.p = half(pq.slice(0, 2), ""); h2.p = half(pq.slice(2), ""); }
  const drill = [cq[0], cq[1], h1, cq[2], cq[3], h2];
  drill.forEach((c) => { c.drill = true; });

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

  return { fyA, hist: incA.map((r) => fyA[+r.fiscalYear]), drill, cons, consFy, curFY, ltm, lastA, lastQ, latestShares, nReportedQ: cq.filter((c) => c.kind === "A").length };
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
      const dg = L.name === RECON ? 0 : consG(fy) ?? prevDg ?? lineCagr(L.name) ?? 0.04;
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
  const niB = n(B.i.netIncome), fcfB = fcf(B);
  const payB = isNum(niB) && niB > 0 && isNum(divPaid(B)) ? clamp(divPaid(B) / niB, 0, 1.5) : 0;
  const bbB = isNum(fcfB) && fcfB > 0 && isNum(buyback(B)) ? clamp(buyback(B) / fcfB, 0, 1.5) : 0;
  const ar0 = ar(B) ?? 0, inv0 = n(B.b.inventory) ?? 0, ap0 = n(B.b.accountPayables) ?? 0, dr0 = defRev(B) ?? 0;
  const dso0 = div(ar0, revB) * 365, dio0 = cogsB > 0 ? (inv0 / cogsB) * 365 : 0, dpo0 = cogsB > 0 ? (ap0 / cogsB) * 365 : 0, drp0 = div(dr0, revB) ?? 0;
  const intExpB = n(B.i.interestExpense) ?? 0, intIncB = n(B.i.interestIncome) ?? 0;
  const othB = (n(B.i.incomeBeforeTax) ?? ebitB) - ebitB + intExpB - intIncB;
  const histIncr = (() => { const h = hist3(B.fy - 3); const r = h ? div(sub(ebitB, ebit(h)), sub(revB, rev(h))) : null; return isNum(r) ? clamp(r, -0.5, 0.9) : div(ebitB, revB); })();
  const consIncr = (fy) => {
    const ce = ebit(m.consFy[fy] || {}), pe = fy === m.curFY ? ebitB : ebit(m.consFy[fy - 1] || {});
    const r = div(sub(ce, pe), sub(consRev(fy), fy === m.curFY ? revB : consRev(fy - 1)));
    return isNum(r) ? clamp(r, -1, 1.5) : null;
  };
  fys.forEach((fy) => {
    setD("gm", fy, gmB); setD("tax", fy, taxB); setD("sbc", fy, sbcB); setD("capex", fy, capexPct);
    setD("pay", fy, payB); setD("bb", fy, bbB); setD("acq", fy, 0); setD("dIss", fy, 0); setD("oth", fy, 0);
    setD("dso", fy, dso0); setD("dio", fy, dio0); setD("dpo", fy, dpo0); setD("dr", fy, drp0);
    setD("incr", fy, consIncr(fy) ?? D["incr|" + (fy - 1)] ?? histIncr);
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
  const method = ["incr", "fixvar", "segment"].includes(inp.costMethod) ? inp.costMethod : "incr";
  const histIncrEbitda = (() => { const h = hist3(B.fy - 3); const r = h ? div(sub(sum(ebitB, daB), ebitda(h)), sub(revB, rev(h))) : null; return isNum(r) ? r : null; })();
  const cashCostB = revB - ebitB - daB;
  fys.forEach((fy) => { setD("var", fy, clamp(1 - (histIncrEbitda ?? 0.35), 0.2, 0.95)); setD("fg", fy, 0.03); });
  const segE0 = {}; lines.forEach((L) => { const v = ov["se0:" + L.name + "|" + B.fy]; segE0[L.name] = isNum(v) ? v : null; });
  lines.forEach((L) => fys.forEach((fy) => setD("si:" + L.name, fy, isNum(segE0[L.name]) && isNum(L.base) && L.base ? segE0[L.name] / L.base : div(ebitB, revB))));
  fys.forEach((fy) => setD("ua", fy, 0));

  // ----- run the years -----
  const out = {};
  let prev = { rev: revB, ebit: ebitB, cash: cashST(B) ?? 0, ar: ar0, inv: inv0, ap: ap0, dr: dr0, debt: debt(B) ?? 0, depBase, gw: n(B.b.goodwill) ?? Math.max((n(B.b.goodwillAndIntangibleAssets) ?? 0) - intgB, 0), shares: n(B.i.weightedAverageShsOutDil), fixed: null, segE: { ...segE0 }, ua: null };
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
    const capexV = I("capex", fy) * r;
    // D&A: existing asset base runs off straight-line; each capex vintage depreciates over its useful life (half-year in year one)
    const daExist = Math.max(existLeft, 0) * scal.rem; existLeft -= daExist;
    vint.push({ amt: capexV, left: capexV, first: true });
    let daNew = 0;
    vint.forEach((v) => { const d = Math.min(v.left, (v.amt / scal.life) * (v.first ? 0.5 : 1)); v.left -= d; v.first = false; daNew += d; });
    const daV = daExist + daNew;

    let ebitV, fixedV = null, varV = null, segE = null, uaV = null;
    if (method === "incr") ebitV = prev.ebit + I("incr", fy) * dRev;
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
    const pretax = ebitV - intExp + intInc + I("oth", fy);
    const taxV = pretax * I("tax", fy);
    const ni = pretax - taxV;
    const sbc = I("sbc", fy) * r;
    const arV = (I("dso", fy) / 365) * r, invV = (I("dio", fy) / 365) * cogs, apV = (I("dpo", fy) / 365) * cogs, drV = I("dr", fy) * r;
    const dNwc = (arV + invV - apV - drV) - (prev.ar + prev.inv - prev.ap - prev.dr);
    const cfoV = ni + daV + sbc - dNwc;
    const fcfV = cfoV - capexV;
    const divV = I("pay", fy) * Math.max(ni, 0);
    const bbV = I("bb", fy) * Math.max(fcfV, 0);
    const acqV = Math.abs(I("acq", fy)), dIss = I("dIss", fy);
    const cash = prev.cash + fcfV - acqV - divV - bbV + dIss;
    const debtV = prev.debt + dIss;
    const depBaseV = prev.depBase + capexV - daV;
    const gwV = prev.gw + acqV;
    const sharesEnd = isNum(prev.shares) ? prev.shares + (sbc - bbV) / scal.px : null;
    const sharesAvg = isNum(sharesEnd) ? (prev.shares + sharesEnd) / 2 : null;
    equity = equity + ni - divV - bbV + sbc;
    const tca = cash + arV + invV + otherCA;
    const ta = tca + depBaseV + gwV + otherNCA;
    const tl = apV + drV + debtV + otherL;
    out[fy] = {
      fy, rev: r, gm, cogs, ebit: ebitV, da: daV, daExist, daNew, capex: capexV, intExp, intInc, pretax, tax: taxV, ni, sbc, dNwc, cfo: cfoV, fcf: fcfV, div: divV, bb: bbV, acq: acqV, dIss,
      cash, debt: debtV, equity, shares: sharesAvg, sharesEnd, eps: div(ni, sharesAvg), fixed: fixedV, var: varV, segE, ua: uaV, check: ta - tl - equity,
      ctx: {
        ...FY_CTX, kind: "E", model: true, fy, label: "FY" + fy,
        i: { revenue: r, costOfRevenue: cogs, grossProfit: r - cogs, operatingExpenses: r - cogs - ebitV, operatingIncome: ebitV, depreciationAndAmortization: daV, interestExpense: intExp, interestIncome: intInc, incomeBeforeTax: pretax, incomeTaxExpense: taxV, netIncome: ni, weightedAverageShsOutDil: sharesAvg, epsDiluted: div(ni, sharesAvg) },
        c: { netIncome: ni, depreciationAndAmortization: daV, stockBasedCompensation: sbc, changeInWorkingCapital: -dNwc, netCashProvidedByOperatingActivities: cfoV, capitalExpenditure: -capexV, freeCashFlow: fcfV, acquisitionsNet: -acqV, commonStockRepurchased: -bbV, netDividendsPaid: -divV, netDebtIssuance: dIss, _daExist: daExist, _daNew: daNew },
        b: { cashAndShortTermInvestments: cash, accountsReceivables: arV, inventory: invV, totalCurrentAssets: tca, propertyPlantEquipmentNet: depBaseV * ppeShare, goodwillAndIntangibleAssets: gwV + depBaseV * (1 - ppeShare), totalAssets: ta, accountPayables: apV, deferredRevenue: drV, totalDebt: debtV, totalLiabilities: tl, totalStockholdersEquity: equity, _check: ta - tl - equity },
        [field]: basis === "total" ? undefined : Object.fromEntries(lines.filter((L) => L.name !== RECON).map((L) => [L.name, L.vals[fy]])),
      },
    };
    prev = { rev: r, ebit: ebitV, cash, ar: arV, inv: invV, ap: apV, dr: drV, debt: debtV, depBase: depBaseV, gw: gwV, shares: sharesEnd, fixed: fixedV ?? prev.fixed, segE: segE || prev.segE, ua: uaV ?? prev.ua };
  });
  // chain YoY: first model year compares with the last reported year
  let pc = B;
  fys.forEach((fy) => { out[fy].ctx.p = pc; pc = out[fy].ctx; });
  return { fys, B, basis, field, lines, R, out, I, D, ov, method, scal, dflt, fixed0, fixedNeg, uaBase, segE0, histLine, consRev };
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
    kdPre: rf + syn.spread, rating: syn.rating, coverage: cov, tm: 0.25,
    g: Math.min(0.025, rf), mT: div(last.ebit, last.rev) ?? 0.1, betaT: 1, roicT: null, s2c: null, wacc: null, lti: 1, mid: 0,
  };
}

function runDcf(mdl, mkt, setIn, shift) {
  const d0 = dcfDefaults(mdl, mkt);
  const s = { ...d0 };
  Object.keys(setIn || {}).forEach((k) => { if (isNum(setIn[k])) s[k] = setIn[k]; });
  const E = mkt.mcap, Dv = mkt.debt ?? 0;
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

  const rows = [];
  let prevRev = rev(mdl.B);
  let reinvSum = 0, dRevSum = 0;
  mdl.fys.forEach((fy, k) => {
    const o = mdl.out[fy];
    const t = mdl.I("tax", fy);
    const nopat = o.ebit * (1 - t);
    const reinv = o.capex - o.da + o.dNwc + o.acq;
    reinvSum += reinv; dRevSum += o.rev - prevRev;
    rows.push({ yr: k + 1, label: "FY" + fy + "E", rev: o.rev, g: growth(o.rev, prevRev), margin: div(o.ebit, o.rev), ebit: o.ebit, tax: t, nopat, reinv, fcff: nopat - reinv, wacc });
    prevRev = o.rev;
  });
  const s2cDflt = dRevSum > 0 && reinvSum > 0 ? clamp(dRevSum / reinvSum, 0.3, 8) : clamp(div(rev(mdl.B), mkt.ic) ?? 1.5, 0.3, 8);
  const s2c = isNum(s.s2c) ? s.s2c : s2cDflt;
  const l5 = rows[rows.length - 1];
  const g5 = l5.g ?? g, m5 = l5.margin, t5 = l5.tax;
  for (let k = 6; k <= 10; k++) {
    const f = (k - 5) / 5;
    const gk = g5 + (g - g5) * f, mk = m5 + (s.mT - m5) * f, tk = t5 + (s.tm - t5) * f, wk = wacc + (waccT - wacc) * f;
    const r = prevRev * (1 + gk);
    const e = r * mk, nopat = e * (1 - tk), reinv = (r - prevRev) / s2c;
    rows.push({ yr: k, label: "Year " + k, rev: r, g: gk, margin: mk, ebit: e, tax: tk, nopat, reinv, fcff: nopat - reinv, wacc: wk, fade: true });
    prevRev = r;
  }
  // discounting: valuation date = today; year 1 = current fiscal year
  const elapsed = clamp(mkt.elapsed ?? 0, 0, 0.99);
  let df = 1;
  rows.forEach((r, ix) => {
    const len = ix === 0 ? 1 - elapsed : 1;
    df = df / Math.pow(1 + r.wacc, len);
    r.df = s.mid ? df * Math.pow(1 + r.wacc, Math.min(len, 1) / 2) : df;
    r.pv = r.fcff * r.df;
  });
  let ic = mkt.ic;
  rows.forEach((r) => { r.icBeg = ic; r.roic = isNum(ic) && ic > 0 ? r.nopat / ic : null; if (isNum(ic)) ic += r.reinv; });
  // Default terminal ROIC: halfway between the model's year-5 ROIC and the stable-period cost of capital
  // (excess returns fade but do not vanish); set it to WACC for Damodaran's no-moat case.
  const roic5 = rows[4]?.roic;
  const roicDflt = isNum(roic5) ? clamp((roic5 + waccT) / 2, waccT, 0.4) : waccT;
  const roicT = isNum(s.roicT) ? s.roicT : roicDflt;
  const last = rows[rows.length - 1];
  const revT = last.rev * (1 + g), ebitT = revT * s.mT, nopatT = ebitT * (1 - s.tm);
  const reinvRateT = roicT > 0 ? g / roicT : 0;
  const fcffT = nopatT * (1 - reinvRateT);
  const tv = waccT > g ? fcffT / (waccT - g) : null;
  const pvTv = isNum(tv) ? tv * last.df : null;
  const pvSum = rows.reduce((a, r) => a + r.pv, 0);
  const ev = isNum(pvTv) ? pvSum + pvTv : null;
  const equity = isNum(ev) ? ev - (mkt.debt ?? 0) - (mkt.minority ?? 0) + (mkt.cash ?? 0) + (s.lti ? mkt.lti ?? 0 : 0) : null;
  const perShare = div(equity, mkt.shares);
  return {
    s, d0, ke, keT, kdAT, wE, waccCalc, wacc, waccT, g, roicT, roicDflt, s2c, s2cDflt, rows,
    terminal: { rev: revT, ebit: ebitT, nopat: nopatT, reinvRate: reinvRateT, fcff: fcffT, tv, pvTv },
    pvSum, ev, equity, perShare, upside: isNum(perShare) && isNum(mkt.price) ? perShare / mkt.price - 1 : null,
    tvShare: div(pvTv, ev),
  };
}
// ENGINE END
