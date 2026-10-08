import test from "node:test";
import assert from "node:assert/strict";
import { damodaranDcf, dcfSensitivity } from "../netlify/lib/dcf.mjs";

const mature = {
  price: 100, sharesOut: 1000, dilutedShares: 1010, marketCap: 100000, totalDebt: 10000, leases: 1000, cash: 5000, nonOperatingAssets: 2000, minorityInterest: 0,
  beta: 1.1, riskFree: 4.0, erp: 4.5, nol: 0,
  latest: { revenue: 50000, ebit: 10000, taxRate: 18, interestExpense: 400, investedCapital: 20000 },
  estimates: [{ date: "2027-09-30", revenue: 54000, ebit: 11000 }, { date: "2028-09-30", revenue: 58000, ebit: 12000 }, { date: "2029-09-30", revenue: 62000, ebit: 13000 }],
};

test("ten-year horizon with consensus then extrapolation fading to terminal growth", () => {
  const r = damodaranDcf(mature);
  assert.ok(r);
  assert.equal(r.years.length, 10);
  assert.equal(r.years.filter((y) => y.source === "consensus").length, 3);
  assert.ok(Math.abs(r.years[9].growth - r.inputs.g / 100) < 1e-9, "year-10 growth equals terminal growth");
  assert.ok(r.years[9].wacc <= r.years[0].wacc + 1e-9 || r.years[9].wacc >= r.years[0].wacc - 1e-9);
  assert.ok(Math.abs(r.years[9].wacc - r.inputs.waccMature) < 1e-9, "cost of capital reaches the mature level by year 10");
  assert.ok(Math.abs(r.years[9].margin - r.story.targetMarginPct / 100) < 1e-9);
  assert.equal(r.inputs.shares, 1010, "diluted share count is used");
  assert.ok(r.inputs.debt === 11000, "leases are added to debt");
  assert.ok(r.story.failurePct > 0 && r.story.failurePct < 3, "investment-grade failure probability");
  assert.ok(r.enterpriseValue < r.goingConcernValue);
  assert.ok(r.perShare > 0);
});

test("accumulated losses shelter early profits and loss-makers carry a higher failure probability", () => {
  const young = { ...mature, nol: 20000, latest: { ...mature.latest, ebit: -2000, interestExpense: 0 }, estimates: [{ date: "2027-12-31", revenue: 60000, ebit: 1000 }, { date: "2028-12-31", revenue: 75000, ebit: 6000 }] };
  const r = damodaranDcf(young);
  assert.ok(r);
  assert.equal(r.years[0].nopat, r.years[0].ebit, "no tax while losses are carried forward");
  assert.ok(r.story.failurePct >= 15);
  assert.ok(r.years[0].taxRate >= 0);
});

test("sensitivity grids move in the right direction", () => {
  const base = damodaranDcf(mature);
  const s = dcfSensitivity(mature, base);
  assert.equal(s.grid[1][1], base.perShare);
  assert.ok(s.grid[0][1] > s.grid[2][1], "lower WACC, higher value");
  assert.equal(s.storyGrid[1][1], base.perShare);
  assert.ok(s.storyGrid[2][2] > s.storyGrid[0][0], "more growth and margin, higher value");
  assert.ok(s.storyAxis.cagr[2] > s.storyAxis.cagr[0]);
  assert.equal(s.storyAxis.margin[1], base.story.targetMarginPct);
});
