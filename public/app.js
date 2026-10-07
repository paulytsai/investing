/* Kabukaizu — single-page app (no build step). */
(function () {
  const state = {
    config: null, user: null, ent: null, locale: "ja", route: { view: "home" },
    symbol: null, bundle: null, chartRange: "1y", chartCache: {}, summary: null, summaryStatus: null, tab: 0,
    summaryTimer: null, summaryTries: 0,
  };
  const $ = (s) => document.querySelector(s);
  const app = $("#app");

  // ---------- i18n & formatting ----------
  function t(key, vars) {
    const dict = window.I18N[state.locale] || window.I18N.ja;
    let v = key.split(".").reduce((o, k) => (o ? o[k] : undefined), dict);
    if (v === undefined) v = key.split(".").reduce((o, k) => (o ? o[k] : undefined), window.I18N.en) ?? key;
    if (typeof v === "string" && vars) for (const k in vars) v = v.replace(`{${k}}`, vars[k]);
    return v;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isCJK = () => state.locale !== "en";
  const NA = "‥";
  function fmtInt(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return NA;
    const n = Math.round(v);
    const s = Math.abs(n).toLocaleString("en-US");
    return n < 0 ? (isCJK() ? "▲" + s : "-" + s) : s;
  }
  function fmtDec(v, d = 2) {
    if (v === null || v === undefined || Number.isNaN(v)) return NA;
    const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    return v < 0 ? (isCJK() ? "▲" + s : "-" + s) : s;
  }
  function fmtPct(v, d = 1) {
    return v === null || v === undefined ? NA : `${fmtDec(v, d)}%`;
  }
  function fmtBig(valueM) {
    if (valueM === null || valueM === undefined) return NA;
    if (isCJK()) return `${fmtInt(valueM / 100)}${t("billion")}${t("unitUsd")}`;
    return `$${(valueM / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`;
  }
  function fmtDate(iso, opts) {
    if (!iso) return NA;
    const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
    const loc = state.locale === "ja" ? "ja-JP" : state.locale === "zh-TW" ? "zh-TW" : "en-US";
    return d.toLocaleDateString(loc, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC", ...(opts || {}) });
  }
  function yymm(iso) { return iso ? `${iso.slice(2, 4)}.${Number(iso.slice(5, 7))}` : NA; }
  function monthName(m) {
    if (!m) return NA;
    if (state.locale === "en") return new Date(Date.UTC(2000, m - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    return `${m}月`;
  }

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: "same-origin", headers: { "content-type": "application/json", ...(opts.headers || {}) }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error((data && data.message) || res.statusText);
      err.status = res.status; err.code = data && data.error; err.data = data;
      throw err;
    }
    return data;
  }

  // ---------- locale ----------
  function setLocale(loc, persist = true) {
    if (!state.config.locales.includes(loc)) loc = state.config.defaultLocale;
    state.locale = loc;
    document.documentElement.lang = loc;
    document.title = state.symbol && state.route.view === "stock" ? `${state.symbol} | ${t("siteName")}` : t("siteName");
    $("#searchInput").placeholder = t("searchPlaceholder");
    $("#searchBtn").textContent = t("search");
    try { localStorage.setItem("locale", loc); } catch {}
    if (persist && state.user && state.user.locale !== loc) api("/api/auth/locale", { method: "POST", body: { locale: loc } }).then((r) => { state.user = r.user; }).catch(() => {});
    renderUserMenu();
    render();
  }

  // ---------- user menu ----------
  function renderUserMenu() {
    const langs = state.config.locales.length > 1
      ? `<span class="lang">${state.config.locales.map((l) => `<button data-lang="${l}" class="${l === state.locale ? "active" : ""}">${window.LOCALE_NAMES[l]}</button>`).join("")}</span>`
      : "";
    let right = "";
    if (state.user) {
      right = `${entPill()}<a href="#/account">${esc(state.user.username)}</a><button class="btn small" id="logoutBtn">${t("logout")}</button>`;
    } else {
      right = `<a href="#/login">${t("login")}</a><a class="btn small primary" href="#/signup">${t("signup")}</a>`;
    }
    $("#userMenu").innerHTML = langs + right;
    document.querySelectorAll("#userMenu [data-lang]").forEach((b) => b.addEventListener("click", () => setLocale(b.dataset.lang)));
    const lo = $("#logoutBtn");
    if (lo) lo.addEventListener("click", async () => { await api("/api/auth/logout", { method: "POST" }); state.user = null; state.ent = null; location.hash = "#/"; renderUserMenu(); render(); });
  }
  function entPill() {
    const e = state.ent;
    if (!e) return "";
    if (e.state === "trial") return `<span class="pill warn">${t("trialDaysLeft", { n: e.daysLeft })}</span>`;
    if (e.state === "subscribed") return `<span class="pill">${t("subscribed")}</span>`;
    if (e.state === "cancelled_grace") return `<span class="pill warn">${t("cancelledGrace", { date: fmtDate(e.endsAt) })}</span>`;
    return `<span class="pill warn">${t(e.state === "lapsed" ? "lapsed" : "trialExpired")}</span>`;
  }

  // ---------- routing ----------
  function parseRoute() {
    const h = location.hash.replace(/^#\/?/, "");
    const [a, b] = h.split("/");
    if (a === "s" && b) return { view: "stock", symbol: decodeURIComponent(b).toUpperCase() };
    if (["login", "signup", "account", "subscribe"].includes(a)) return { view: a };
    return { view: "home" };
  }
  window.addEventListener("hashchange", () => { state.route = parseRoute(); render(); });

  function render() {
    const r = state.route;
    if (r.view === "login") return renderAuth("login");
    if (r.view === "signup") return renderAuth("signup");
    if (r.view === "account") return state.user ? renderAccount() : renderAuth("login");
    if (r.view === "subscribe") return renderPaywall();
    if (r.view === "stock") return state.user ? loadStock(r.symbol) : renderAuth("login");
    return renderHome();
  }

  // ---------- views ----------
  function renderHome() {
    stopSummaryPolling();
    const price = state.config.priceLabel;
    if (!state.user) {
      app.innerHTML = `<div class="panel hero"><div class="brand">${$("#logoTpl").innerHTML}<span class="brand-text"><span class="brand-name">Kabukaizu</span><span class="brand-sub">US Stock Almanac</span></span></div><p>${t("tagline")}</p>
        <ul>${t("features").map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
        <p><b>${t("pricing")}</b>: ${t("priceLine", { price })}<br>${t("trialNote", { price })}</p>
        <div class="actions"><a class="btn primary" href="#/signup">${t("createAccount")}</a><a class="btn" href="#/login">${t("login")}</a></div></div>
        <div class="footer">${t("sources")}<br>${t("disclaimer")}</div>`;
      return;
    }
    let recent = [];
    try { recent = JSON.parse(localStorage.getItem("recent") || "[]"); } catch {}
    app.innerHTML = `<div class="panel center"><p>${t("welcome")}</p>
      ${recent.length ? `<p>${recent.map((s) => `<a href="#/s/${esc(s)}" class="btn small" style="margin:2px">${esc(s)}</a>`).join(" ")}</p>` : ""}</div>
      <div class="footer">${t("sources")}<br>${t("disclaimer")}</div>`;
  }

  function renderAuth(kind) {
    stopSummaryPolling();
    const isSignup = kind === "signup";
    app.innerHTML = `<div class="panel form"><h2>${t(isSignup ? "signup" : "login")}</h2>
      ${isSignup ? `<p class="muted">${t("trialNote", { price: state.config.priceLabel })}</p>` : ""}
      <div id="formError"></div>
      <form id="authForm">
        ${isSignup ? `<label>${t("username")}<input name="username" required minlength="3" maxlength="32" autocomplete="username"></label>
        <label>${t("email")}<input name="email" type="email" required autocomplete="email"></label>` : `<label>${t("loginId")}<input name="login" required autocomplete="username"></label>`}
        <label>${t("password")}<input name="password" type="password" required minlength="8" autocomplete="${isSignup ? "new-password" : "current-password"}"></label>
        <button class="btn primary" type="submit">${t(isSignup ? "createAccount" : "login")}</button>
      </form>
      <div class="alt">${isSignup ? `${t("haveAccount")} <a href="#/login">${t("login")}</a>` : `${t("noAccount")} <a href="#/signup">${t("signup")}</a>`}</div></div>`;
    $("#authForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target).entries());
      const btn = ev.target.querySelector("button"); btn.disabled = true;
      try {
        const r = await api(`/api/auth/${isSignup ? "signup" : "login"}`, { method: "POST", body: { ...fd, locale: state.locale } });
        state.user = r.user; state.ent = r.entitlement;
        renderUserMenu();
        const back = sessionStorage.getItem("after_login");
        sessionStorage.removeItem("after_login");
        location.hash = back || "#/";
        if (location.hash === (back || "#/")) { state.route = parseRoute(); render(); }
      } catch (e) {
        $("#formError").innerHTML = `<div class="error">${esc(t(`errors.${e.code}`) !== `errors.${e.code}` ? t(`errors.${e.code}`) : e.message)}</div>`;
        btn.disabled = false;
      }
    });
  }

  function statusLine() {
    const e = state.ent;
    if (!e) return "";
    if (e.state === "trial") return t("trialDaysLeft", { n: e.daysLeft }) + ` (${fmtDate(new Date(e.trialEndsAt).toISOString())})`;
    if (e.state === "subscribed") return `${t("subscribed")}${e.renewsAt ? ` · ${fmtDate(e.renewsAt)}` : ""}`;
    if (e.state === "cancelled_grace") return t("cancelledGrace", { date: fmtDate(e.endsAt) });
    return t(e.state === "lapsed" ? "lapsed" : "trialExpired");
  }

  function renderAccount() {
    stopSummaryPolling();
    const u = state.user; const e = state.ent;
    const canSubscribe = state.config.billingEnabled && !(e && e.state === "subscribed");
    const hasSub = u.subscription && u.subscription.id;
    app.innerHTML = `<div class="panel form"><h2>${t("account")}</h2>
      <div class="kv"><div>${t("username")}</div><div>${esc(u.username)}</div><div>${t("email")}</div><div>${esc(u.email)}</div><div>${t("pricing")}</div><div>${statusLine()}</div></div>
      <div id="formError"></div>
      ${canSubscribe ? `<button class="btn primary" id="subscribeBtn">${t("subscribe")} — ${esc(state.config.priceLabel)}</button>` : ""}
      ${hasSub ? `<button class="btn" id="portalBtn">${t("manageBilling")}</button>` : ""}
      <p class="muted" style="margin-top:14px">${t("priceLine", { price: state.config.priceLabel })}</p></div>`;
    bindBilling();
  }

  function renderPaywall() {
    stopSummaryPolling();
    app.innerHTML = `<div class="panel form"><h2>${t("paywallTitle")}</h2><p>${t("paywallBody", { price: state.config.priceLabel })}</p>
      <div id="formError"></div>
      ${state.config.billingEnabled ? `<button class="btn primary" id="subscribeBtn">${t("subscribe")} — ${esc(state.config.priceLabel)}</button>` : `<p class="error">${t("errors.billing_not_configured")}</p>`}
      ${state.user && state.user.subscription && state.user.subscription.id ? `<button class="btn" id="portalBtn">${t("manageBilling")}</button>` : ""}</div>`;
    bindBilling();
  }

  function bindBilling() {
    const go = async (action) => {
      try { const r = await api(`/api/billing/${action}`); window.location.href = r.url; }
      catch (e) { $("#formError").innerHTML = `<div class="error">${esc(t(`errors.${e.code}`) !== `errors.${e.code}` ? t(`errors.${e.code}`) : e.message)}</div>`; }
    };
    const s = $("#subscribeBtn"); if (s) s.addEventListener("click", () => go("checkout"));
    const p = $("#portalBtn"); if (p) p.addEventListener("click", () => go("portal"));
  }

  // ---------- stock ----------
  async function loadStock(symbol) {
    stopSummaryPolling();
    if (state.symbol !== symbol) { state.bundle = null; state.chartCache = {}; state.summary = null; state.summaryStatus = null; }
    state.symbol = symbol;
    if (!state.bundle) {
      app.innerHTML = `<div class="panel spinner">${esc(symbol)} …</div>`;
      try {
        state.bundle = await api(`/api/stock/${encodeURIComponent(symbol)}`);
      } catch (e) {
        if (e.status === 402) { state.ent = e.data && e.data.entitlement || state.ent; renderUserMenu(); return renderPaywall(); }
        if (e.status === 401) { sessionStorage.setItem("after_login", location.hash); return renderAuth("login"); }
        app.innerHTML = `<div class="panel"><div class="error">${t(e.status === 404 || e.code === "not_a_company" || e.code === "invalid_symbol" ? "notFound" : "loadError")}</div></div>`;
        return;
      }
      try {
        const recent = JSON.parse(localStorage.getItem("recent") || "[]").filter((s) => s !== symbol);
        recent.unshift(symbol); localStorage.setItem("recent", JSON.stringify(recent.slice(0, 10)));
      } catch {}
    }
    document.title = `${symbol} | ${t("siteName")}`;
    renderStock();
    loadChart(state.chartRange);
    loadSummary();
  }

  function renderStock() {
    const b = state.bundle; const m = b.market;
    const chg = m.change ?? 0;
    const cls = chg > 0 ? "up" : chg < 0 ? "down" : "";
    const sign = chg > 0 ? "+" : "";
    app.innerHTML = `
      <div class="panel">
        <div class="title-row"><h1><span class="sym">【${esc(b.symbol)}】${esc(b.company.name)}</span><span class="ex">${esc(b.company.exchange)}</span></h1>
          <div class="price">$${fmtDec(m.price)} <small class="${cls}">${sign}${fmtDec(m.change)} (${sign}${fmtDec(m.changePct)}%)</small></div></div>
        <div class="meta">${t("updated", { date: fmtDate(m.quoteTime || b.asOf) })}</div>
        <div class="ranges" id="ranges">${Object.keys(t("ranges")).map((r) => `<button data-range="${r}" class="${r === state.chartRange ? "active" : ""}">${t("ranges")[r]}</button>`).join("")}</div>
        <div class="chart" id="chart"></div>
      </div>
      <div class="panel">
        <div class="tabs" id="tabs">${t("tabs").map((x, i) => `<button data-tab="${i}" class="${i === state.tab ? "active" : ""}">${esc(x)}</button>`).join("")}</div>
        <div id="tabBody"></div>
      </div>
      <div class="footer">${t("aiNote")}<br>${t("sources")}<br>${t("disclaimer")}</div>`;
    document.querySelectorAll("#ranges button").forEach((btn) => btn.addEventListener("click", () => { state.chartRange = btn.dataset.range; document.querySelectorAll("#ranges button").forEach((x) => x.classList.toggle("active", x === btn)); loadChart(state.chartRange); }));
    document.querySelectorAll("#tabs button").forEach((btn) => btn.addEventListener("click", () => { state.tab = Number(btn.dataset.tab); document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === btn)); renderTab(); }));
    renderTab();
  }

  async function loadChart(range) {
    const el = $("#chart"); if (!el) return;
    const key = `${state.symbol}:${range}`;
    if (!state.chartCache[key]) {
      el.innerHTML = `<div class="spinner">…</div>`;
      try { state.chartCache[key] = await api(`/api/chart/${encodeURIComponent(state.symbol)}?range=${range}`); }
      catch (e) { el.innerHTML = `<div class="error">${t("loadError")}</div>`; return; }
    }
    if (state.chartRange !== range) return;
    window.renderChart(el, state.chartCache[key].points, { locale: state.locale });
  }

  function renderTab() {
    const body = $("#tabBody"); if (!body) return;
    body.innerHTML = [tabBasic, tabResults, tabCapital][state.tab]();
  }

  function aiBox(part) {
    const s = state.summary;
    if (s && s[part]) return `<span class="hl">${esc(s[part].headline)}</span><span class="body">${esc(s[part].body)}</span>`;
    if (state.summaryStatus === "pending" || state.summaryStatus === null) return `<span class="spinner">${t("generating")}</span>`;
    if (state.summaryStatus === "disabled") return `<span class="muted">${t("summaryDisabled")}</span>`;
    return `<span class="muted">${t("summaryError")}</span>`;
  }

  function tabBasic() {
    const b = state.bundle; const c = b.company; const m = b.market; const f = b.financials;
    const seg = c.segments.length ? c.segments.map((s) => `${esc(s.name)}${s.sharePct ?? "?"}`).join("、") + (c.segmentsFiscalYear ? ` <${c.segmentsFiscalYear}>` : "") : NA;
    const feature = state.summary ? esc(state.summary.feature) : esc((c.businessSummary || c.description || "").slice(0, 220));
    const rating = m.analystRating ? `${esc(m.analystRating.consensus)}（Buy ${m.analystRating.buy} / Hold ${m.analystRating.hold ?? 0} / Sell ${m.analystRating.sell}）` : NA;
    const target = m.analystTarget ? `$${fmtDec(m.analystTarget.consensus)}（$${fmtDec(m.analystTarget.low)}〜$${fmtDec(m.analystTarget.high)}）` : NA;
    const row = (th, td, cls = "") => `<tr class="${cls}"><th class="rowh">${th}</th><td>${td}</td></tr>`;
    return `<table class="shk">
      ${row(t("name"), `${esc(c.name)}${c.ceo ? `<span class="muted">　${t("ceo")}: ${esc(c.ceo)}</span>` : ""}`)}
      ${row(t("fiscalYear"), monthName(c.fiscalYearEndMonth))}
      ${row(t("ipo"), `${fmtDate(c.ipoDate, { month: "numeric", day: undefined })}${c.stateOfIncorporation ? `　<span class="muted">${t("incorporation")}: ${esc(c.stateOfIncorporation)}</span>` : ""}`)}
      ${row(t("feature"), feature)}
      ${row(t("segments"), seg)}
      ${row(t("sector"), `${esc(c.sector || "")} / ${esc(c.industry || "")}${c.sicDescription ? `　<span class="muted">${t("sic")}: ${esc(c.sicDescription)} (${esc(c.sicCode)})</span>` : ""}`)}
      ${row(`<b>${t("longTerm")}</b>`, `<div class="ai">${aiBox("longTerm")}</div>`)}
      ${row(`<b>${t("recent")}</b>`, `<div class="ai">${aiBox("recent")}</div>`)}
      ${row(t("hq"), esc(c.address || NA))}
      ${row(t("phone"), esc(c.phone || NA))}
      ${row(t("employees"), c.employees ? `${fmtInt(c.employees)}${isCJK() ? "名" : ""}${c.employeesAsOf ? ` <${yymm(c.employeesAsOf)}>` : ""}` : NA)}
      ${row(t("exchange"), `${esc(c.exchangeFullName || c.exchange)}${c.filerCategory ? `　<span class="muted">${esc(c.filerCategory)}</span>` : ""}`)}
      ${row(t("url"), c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.website)}</a>` : NA)}
      ${row(t("shares"), `${t("sharesOut")} ${fmtInt(m.sharesOutstandingM)}${t("millionShares")}　${t("marketCap")} ${fmtBig(m.marketCapM)}　${t("per")} ${fmtDec(m.per, 1)}　${t("pbr")} ${fmtDec(m.pbr, 1)}`)}
      ${row(t("opMargin"), `${fmtPct(b.growth.operatingMarginPct)}${b.growth.operatingMarginPrevPct !== null ? `(${b.growth.operatingMarginPct - b.growth.operatingMarginPrevPct >= 0 ? "+" : ""}${fmtDec(b.growth.operatingMarginPct - b.growth.operatingMarginPrevPct, 1)}pt)` : ""}　${isCJK() ? "売上5年平均成長率" : "5-yr revenue CAGR"} ${fmtPct(b.growth.revenueCagr5Pct)}`)}
      ${row(t("peers"), c.peers.length ? c.peers.map((p) => `<a href="#/s/${esc(p.symbol)}">${esc(p.symbol)}</a> ${esc(p.name)}`).join("、") : NA)}
      ${row(t("nextEarnings"), `${fmtDate(b.nextEarnings)}　<span class="muted">${t("analysts")}: ${rating}　${t("target")}: ${target}</span>`)}
    </table>
    ${f ? `<table class="shk"><tr><th class="rowh"><b>【${t("financials")}】</b></th><th>&lt;${yymm(f.asOf)}&gt; ${t("unitM")}</th></tr>
      <tr><th class="rowh">${t("totalAssets")}</th><td class="num">${fmtInt(f.totalAssets)}</td></tr>
      <tr><th class="rowh">${t("equity")}</th><td class="num">${fmtInt(f.equity)}</td></tr>
      <tr><th class="rowh">${t("equityRatio")}</th><td class="num">${fmtPct(f.equityRatioPct)}</td></tr>
      <tr><th class="rowh">${t("commonStock")}</th><td class="num">${fmtInt(f.commonStock)}</td></tr>
      <tr><th class="rowh">${t("retained")}</th><td class="num">${fmtInt(f.retainedEarnings)}</td></tr>
      <tr><th class="rowh">${t("debt")}</th><td class="num">${fmtInt(f.totalDebt)}</td></tr>
      <tr><th class="rowh">${t("cash")}</th><td class="num">${fmtInt(f.cashAndShortTerm)}</td></tr></table>` : ""}`;
  }

  function tabResults() {
    const b = state.bundle;
    const rows = b.performance.map((r, i, arr) => {
      const prefix = r.kind === "annual" ? t("consolidated") : r.kind === "estimate" ? t("estimate") : "";
      const cls = r.kind === "estimate" ? "est" : r.kind === "quarter" ? "quarter" : "";
      const sep = i > 0 && arr[i - 1].kind !== r.kind ? " sep" : "";
      return `<tr class="${cls}${sep}"><th class="rowh">${prefix}${esc(r.label)}${r.kind === "quarter" ? "" : ""}</th><td class="num">${fmtInt(r.revenue)}</td><td class="num">${fmtInt(r.operatingIncome)}</td><td class="num">${fmtInt(r.pretaxIncome)}</td><td class="num">${fmtInt(r.netIncome)}</td><td class="num">${fmtDec(r.eps)}</td><td class="num">${r.dps === null ? (r.kind === "annual" ? "0" : NA) : fmtDec(r.dps)}</td></tr>`;
    }).join("");
    const estN = (b.performance.find((r) => r.kind === "estimate") || {}).analysts;
    const d = b.dividends;
    const divRows = d.history.map((x) => `<tr><th class="rowh">${yymm(x.date)}</th><td class="num">${fmtDec(x.amount)}</td></tr>`).join("");
    const ind = b.indicators; const cf = b.cashflow; const h = b.holders;
    const pair = (a, p) => `${fmtInt(a)}${p !== null && p !== undefined ? ` <span class="muted">(${fmtInt(p)})</span>` : ""}`;
    return `<div class="grid2"><div>
      <table class="shk"><tr><th class="rowh"><b>【${t("performance")}】</b></th><th>${t("revenue")}</th><th>${t("opIncome")}</th><th>${t("pretax")}</th><th>${t("netIncome")}</th><th>${t("eps")}</th><th>${t("dps")}</th></tr>${rows}</table>
      <div class="note">${t("unitM")}${estN ? `　${t("estimateNote", { n: estN })}` : ""}</div>
    </div><div>
      <table class="shk"><tr><th class="rowh"><b>【${t("dividends")}】</b></th><th>${t("dividendAmount")}</th></tr>${divRows || `<tr><td colspan="2" class="c">${NA}</td></tr>`}
        <tr class="sep"><th class="rowh">${t("yieldLabel")}</th><td class="num">${fmtPct(d.yieldPct, 2)}</td></tr>
        <tr><th class="rowh">${t("bps")}</th><td class="num">${fmtDec(b.market.bps)}</td></tr></table>
      <div class="note">${t("exDate")}</div>
    </div></div>
    <div class="grid2b"><div>
      <table class="shk"><tr><th class="rowh"><b>【${t("indicators")}】</b></th><th>&lt;${esc(ind.fiscalYear || "")}&gt;</th></tr>
        <tr><th class="rowh">${t("roe")}</th><td class="num">${fmtPct(ind.roePct)}　<span class="muted">${t("ttm")} ${fmtPct(ind.roeTTMPct)}</span></td></tr>
        <tr><th class="rowh">${t("roa")}</th><td class="num">${fmtPct(ind.roaPct)}　<span class="muted">${t("ttm")} ${fmtPct(ind.roaTTMPct)}</span></td></tr>
        <tr><th class="rowh">${t("maxNet")}${ind.maxNetIncome ? `(${esc(ind.maxNetIncome.label)})` : ""}</th><td class="num">${ind.maxNetIncome ? fmtInt(ind.maxNetIncome.value) : NA}</td></tr>
        <tr><th class="rowh">${t("capex")}</th><td class="num">${pair(ind.capex, ind.capexPrev)}</td></tr>
        <tr><th class="rowh">${t("depreciation")}</th><td class="num">${pair(ind.depreciation, ind.depreciationPrev)}</td></tr>
        <tr><th class="rowh">${t("rnd")}</th><td class="num">${pair(ind.rnd, ind.rndPrev)}</td></tr>
        <tr><th class="rowh">${t("per")} / ${t("pbr")}</th><td class="num">${fmtDec(ind.per, 1)} / ${fmtDec(ind.pbr, 1)}</td></tr></table>
      <div class="note">${t("unitM")}　( ) = ${isCJK() ? "前期" : "prior year"}</div>
    </div><div>
      ${cf ? `<table class="shk"><tr><th class="rowh"><b>【${t("cashflow")}】</b></th><th>&lt;${esc(cf.fiscalYear)}&gt; ${t("unitM")}</th></tr>
        <tr><th class="rowh">${t("opCF")}</th><td class="num">${pair(cf.operating, cf.operatingPrev)}</td></tr>
        <tr><th class="rowh">${t("invCF")}</th><td class="num">${pair(cf.investing, cf.investingPrev)}</td></tr>
        <tr><th class="rowh">${t("finCF")}</th><td class="num">${pair(cf.financing, cf.financingPrev)}</td></tr>
        <tr><th class="rowh">${t("cashEq")}</th><td class="num">${pair(cf.cash, cf.cashPrev)}</td></tr>
        <tr class="sep"><th class="rowh">${t("fcf")}</th><td class="num">${fmtInt(cf.freeCashFlow)}</td></tr>
        <tr><th class="rowh">${t("buyback")}</th><td class="num">${fmtInt(cf.buybacks)}</td></tr>
        <tr><th class="rowh">${t("divPaid")}</th><td class="num">${fmtInt(cf.dividendsPaid)}</td></tr></table>` : ""}
    </div></div>
    <table class="shk"><tr><th class="rowh"><b>【${t("holders")}】</b></th><th colspan="2">${h.asOf ? t("holdersAsOf", { date: h.asOf }) : ""}${h.summary ? `　${t("investorsHolding")} ${fmtInt(h.summary.investorsHolding)}` : ""}</th></tr>
      <tr><th class="rowh">${t("holderName")}</th><th colspan="2">${t("holderShares")}</th></tr>
      ${h.holders.length ? h.holders.map((x) => `<tr><td colspan="2">${esc(x.name)}</td><td class="num">${fmtDec(x.sharesM, 1)} (${fmtDec(x.ownershipPct, 1)})</td></tr>`).join("") : `<tr><td colspan="3" class="c">${NA}</td></tr>`}
      <tr class="sep"><td colspan="3">&lt;${t("instOwnership")}&gt; ${h.summary ? fmtPct(h.summary.ownershipPct) : NA}　&lt;${t("freeFloat")}&gt; ${fmtPct(b.market.freeFloatPct)}　&lt;${t("insiders")}&gt; ${b.insider ? t("insiderNote", { b: b.insider.purchases ?? 0, s: b.insider.sales ?? 0 }) : NA}</td></tr></table>`;
  }

  function tabCapital() {
    const b = state.bundle; const p = b.prices;
    const caps = b.capitalChanges.filter((c) => c.date >= new Date(Date.now() - 10 * 366 * 86400000).toISOString().slice(0, 10));
    const capRows = caps.length
      ? caps.map((c) => `<tr><th class="rowh">${yymm(c.date)}</th><td class="c">${c.numerator >= c.denominator ? t("split", { a: c.denominator, b: c.numerator }) : t("reverseSplit", { a: c.denominator, b: c.numerator })}</td></tr>`).join("")
      : `<tr><td colspan="2" class="c muted">${t("noSplits")}</td></tr>`;
    const yearly = p.yearly.map((r) => `<tr><th class="rowh">${esc(r.label)}</th><td class="num">${fmtDec(r.high)}(${esc(r.highNote)})</td><td class="num">${fmtDec(r.low)}(${esc(r.lowNote)})</td></tr>`).join("");
    const monthly = p.monthly.map((r) => `<tr><th class="rowh">${r.partial ? "#" : ""}${esc(r.label)}</th><td class="num">${fmtDec(r.high)}</td><td class="num">${fmtDec(r.low)}</td><td class="num">${fmtInt(r.volumeM)}</td></tr>`).join("");
    const half = Math.ceil(b.officers.length / 2);
    const offRows = [];
    for (let i = 0; i < half; i++) {
      const a = b.officers[i]; const c = b.officers[i + half];
      const cell = (o) => (o ? `(${esc(o.title)}) ${esc(o.name)}` : "");
      offRows.push(`<tr><td>${cell(a)}</td><td>${cell(c)}</td></tr>`);
    }
    const filings = b.filings.map((f) => `<tr><th class="rowh">${esc(f.filingDate)}</th><td><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.form)}</a> <span class="muted">${esc(f.description || "")}</span></td></tr>`).join("");
    const events = b.materialEvents.map((e) => `<tr><th class="rowh">${esc(e.filingDate)}</th><td>${esc(e.form)} — ${esc(e.items.join(", "))}</td></tr>`).join("");
    return `<div class="grid2b"><div>
      <table class="shk"><tr><th class="rowh"><b>【${t("capitalChanges")}】</b></th><th>${t("dateCol")}</th></tr>${capRows}</table>
      <table class="shk"><tr><th class="rowh">${esc(b.company.exchange)}</th><th>${t("high")}</th><th>${t("low")}</th></tr>${yearly}</table>
      <div class="note">${t("priceNote1")}</div>
      <table class="shk"><tr><th class="rowh"></th><th>${t("high")}</th><th>${t("low")}</th><th>${t("volume")}</th></tr>${monthly}</table>
      <div class="note">${t("priceNote2")}</div>
    </div><div>
      <table class="shk"><tr><th colspan="2" style="text-align:left"><b>【${t("officers")}】</b></th></tr>${offRows.join("") || `<tr><td colspan="2" class="c">${NA}</td></tr>`}</table>
      <table class="shk"><tr><th colspan="2" style="text-align:left"><b>【${t("filings")}】</b></th></tr>${filings || `<tr><td colspan="2" class="c">${NA}</td></tr>`}</table>
      ${events ? `<table class="shk"><tr><th colspan="2" style="text-align:left"><b>【${t("events")}】</b></th></tr>${events}</table>` : ""}
    </div></div>`;
  }

  // ---------- AI summary polling ----------
  function stopSummaryPolling() { if (state.summaryTimer) clearTimeout(state.summaryTimer); state.summaryTimer = null; }
  async function loadSummary() {
    stopSummaryPolling();
    const symbol = state.symbol; const lang = state.locale;
    if (!state.config.summariesEnabled) { state.summaryStatus = "disabled"; refreshAiBoxes(); return; }
    try {
      const r = await api(`/api/summary/${encodeURIComponent(symbol)}?lang=${encodeURIComponent(lang)}`);
      if (symbol !== state.symbol || lang !== state.locale) return;
      state.summaryStatus = r.status;
      if (r.status === "ready") { state.summary = r.summary; state.summaryTries = 0; refreshAiBoxes(); return; }
      if (r.status === "pending" && state.summaryTries < 40) {
        state.summaryTries++;
        state.summaryTimer = setTimeout(loadSummary, 6000);
      }
      refreshAiBoxes();
    } catch (e) {
      state.summaryStatus = "error"; refreshAiBoxes();
    }
  }
  function refreshAiBoxes() { if (state.route.view === "stock" && state.tab === 0 && $("#tabBody")) renderTab(); }

  // ---------- search ----------
  const input = $("#searchInput"); const suggest = $("#suggest");
  let debounce = null; let activeIdx = -1; let suggestions = [];
  function go(symbol) {
    suggest.style.display = "none"; input.value = "";
    if (!state.user) { sessionStorage.setItem("after_login", `#/s/${symbol}`); location.hash = "#/login"; return; }
    location.hash = `#/s/${encodeURIComponent(symbol)}`;
  }
  $("#searchForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (activeIdx >= 0 && suggestions[activeIdx]) return go(suggestions[activeIdx].symbol);
    const v = input.value.trim().toUpperCase();
    if (v) go(v);
  });
  input.addEventListener("input", () => {
    clearTimeout(debounce); activeIdx = -1;
    const q = input.value.trim();
    if (q.length < 1 || !state.user) { suggest.style.display = "none"; return; }
    debounce = setTimeout(async () => {
      try {
        const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
        suggestions = r.results || [];
        if (!suggestions.length || input.value.trim() !== q) { suggest.style.display = "none"; return; }
        suggest.innerHTML = suggestions.map((s, i) => `<div data-i="${i}"><b>${esc(s.symbol)}</b><span>${esc(s.name)}</span><small>${esc(s.exchange)}</small></div>`).join("");
        suggest.style.display = "block";
        suggest.querySelectorAll("div").forEach((d) => d.addEventListener("mousedown", () => go(suggestions[Number(d.dataset.i)].symbol)));
      } catch { suggest.style.display = "none"; }
    }, 250);
  });
  input.addEventListener("keydown", (ev) => {
    if (suggest.style.display !== "block") return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      activeIdx = ev.key === "ArrowDown" ? Math.min(suggestions.length - 1, activeIdx + 1) : Math.max(0, activeIdx - 1);
      suggest.querySelectorAll("div").forEach((d, i) => d.classList.toggle("active", i === activeIdx));
    } else if (ev.key === "Escape") suggest.style.display = "none";
  });
  input.addEventListener("blur", () => setTimeout(() => (suggest.style.display = "none"), 150));

  // ---------- boot ----------
  async function init() {
    try { state.config = await api("/api/config"); } catch { state.config = { locales: ["ja", "en"], defaultLocale: "ja", trialDays: 7, priceLabel: "US$15 / month", billingEnabled: false, summariesEnabled: false }; }
    try { const me = await api("/api/auth/me"); state.user = me.user; state.ent = me.entitlement; } catch {}
    let loc = null;
    try { loc = localStorage.getItem("locale"); } catch {}
    if (!loc && state.user) loc = state.user.locale;
    if (!loc) loc = state.config.defaultLocale; // site default (Japanese on the JP site), never the browser language
    state.route = parseRoute();
    setLocale(loc, false);
  }
  init();
})();
