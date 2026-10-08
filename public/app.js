/* Kabukaizu — single-page app (no build step). */
(function () {
  const state = {
    config: null, user: null, ent: null, locale: "ja", route: { view: "home" },
    symbol: null,
  };
  const $ = (s) => document.querySelector(s);
  const app = $("#app");

  // ---------- i18n & formatting ----------
  function t(key, vars) {
    const dict = window.I18N[state.locale] || window.I18N.ja;
    let v = key.split(".").reduce((o, k) => (o ? o[k] : undefined), dict);
    if (v === undefined) v = key.split(".").reduce((o, k) => (o ? o[k] : undefined), window.I18N.en) ?? key;
    if (typeof v === "string" && vars) for (const k in vars) v = v.replace(`{${k}}`, vars[k]);
    if (typeof v === "string" && v.includes("{brand}")) v = v.split("{brand}").join(brandName());
    return v;
  }
  const brandName = () => (state.config && state.config.brand && state.config.brand.name) || "Kabukaizu";
  function applyBrand() {
    const b = (state.config && state.config.brand) || {};
    document.querySelectorAll(".brand-name").forEach((el) => (el.textContent = b.name || "Kabukaizu"));
    document.querySelectorAll(".brand-sub").forEach((el) => (el.textContent = b.sub || "US Stock Almanac"));
    const ico = document.querySelector('link[rel="icon"]'); if (ico && b.favicon) ico.href = b.favicon;
    const touch = document.querySelector('link[rel="apple-touch-icon"]'); if (touch && b.touchIcon) touch.href = b.touchIcon;
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
    if (state.stock.b) { state.stock.s = null; state.stock.summaryStatus = null; }
    if (state.demo.b) { state.demo.s = null; state.demo.summaryStatus = null; }
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
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
    const price = state.config.priceLabel;
    if (!state.user) {
      const L = JSON.parse(JSON.stringify(t("landing")).split("{brand}").join(brandName()));
      app.innerHTML = `
      <section class="hero hero-wave"><img class="hero-seal" src="${esc((state.config.brand && state.config.brand.sealImage) || "/img/seal.png")}" alt="${esc((state.config.brand && state.config.brand.seal) || "株海図")}"><div class="hero-inner"><div class="brand"><span class="brand-text"><span class="brand-name">${esc(brandName())}</span><span class="brand-sub">${esc((state.config.brand && state.config.brand.sub) || "US Stock Almanac")}</span></span></div>
        <h1>${esc(L.heroTitle)}</h1><p class="lead">${esc(L.heroLead)}</p>
        <div class="actions"><a class="btn primary big" href="#/signup">${esc(L.ctaPrimary)}</a><a class="btn big" href="#/login">${esc(L.ctaSecondary)}</a></div>
        <p class="small">${esc(L.ctaNote.replace("{price}", price))}</p>
      </div><span class="hero-credit">葛飾北斎『神奈川沖浪裏』</span></section>
      <section class="land">
        <h2>${esc(L.samplesTitle)}</h2><p class="lead">${esc(L.samplesLead)}</p>
        <div class="demo-frame" data-demo></div>
      </section>
      <section class="land pricing">
        <h2>${esc(L.pricingTitle)}</h2>
        <div class="pricecard"><div class="plan">${esc(L.pricingPlan)}</div><div class="amount">${esc(price)}</div>
          <ul>${L.pricingBullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
          <a class="btn primary big" href="#/signup">${esc(L.ctaPrimary)}</a>
          <p class="muted small">${esc(L.pricingNote)}</p></div>
      </section>
      <div class="footer center">${esc(L.disclaimer)}</div>`;
      mountDemo(app.querySelector("[data-demo]"));
      return;
    }
    // Logged-in home: open the default ticker.
    location.hash = "#/s/AAPL";
    if (location.hash === "#/s/AAPL") { state.route = parseRoute(); render(); }
  }

  function renderAuth(kind) {
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
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
        location.hash = back || "#/s/AAPL";
        if (location.hash === (back || "#/s/AAPL")) { state.route = parseRoute(); render(); }
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
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
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
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
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
  // ---------- stock page component (used by the real page and the landing sample) ----------
  function newCtx(demo) { return { demo, b: null, s: null, summaryStatus: null, chartRange: "1y", chartCache: {}, tab: 0, root: null, timer: null, tries: 0 }; }
  state.stock = newCtx(false);
  state.demo = newCtx(true);

  async function loadStock(symbol) {
    stopSummaryPolling(state.stock);
    const c = state.stock;
    if (state.symbol !== symbol) { c.b = null; c.chartCache = {}; c.s = null; c.summaryStatus = null; c.tab = 0; }
    state.symbol = symbol;
    if (!c.b) {
      app.innerHTML = `<div class="panel spinner">${esc(symbol)} …</div>`;
      try {
        c.b = await api(`/api/stock/${encodeURIComponent(symbol)}`);
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
    app.innerHTML = `<div data-stock></div><div class="footer">${t("aiNote")}<br>${t("disclaimer")}</div>`;
    mountStock(app.querySelector("[data-stock]"), c);
    loadSummary(c);
  }

  function mountStock(container, c) {
    const b = c.b; const m = b.market;
    const chg = m.change ?? 0;
    const cls = chg > 0 ? "up" : chg < 0 ? "down" : "";
    const sign = chg > 0 ? "+" : "";
    c.root = container;
    container.innerHTML = `
      <div class="panel">
        <div class="title-row"><h1><span class="co" data-sym="${esc(b.symbol)}">${esc(b.company.name)}</span><span class="ex">${esc(b.company.exchange)}</span></h1>
          <div class="price">$${fmtDec(m.price)} <small class="${cls}">${sign}${fmtDec(m.change)} (${sign}${fmtDec(m.changePct)}%)</small></div></div>
        <div class="meta">${t("updated", { date: fmtDate(m.quoteTime || b.asOf) })}</div>
        <div class="ranges" data-ranges>${Object.keys(t("ranges")).map((r) => `<button data-range="${r}" class="${r === c.chartRange ? "active" : ""}">${t("ranges")[r]}</button>`).join("")}</div>
        <div class="chart" data-chart></div>
      </div>
      <div class="tabs" data-tabs>${t("tabs").map((x, i) => `<button data-tab="${i}" class="${i === c.tab ? "active" : ""}">${esc(x)}</button>`).join("")}</div>
      <div data-tabbody></div>`;
    container.querySelectorAll("[data-ranges] button").forEach((btn) => btn.addEventListener("click", () => { c.chartRange = btn.dataset.range; container.querySelectorAll("[data-ranges] button").forEach((x) => x.classList.toggle("active", x === btn)); loadChart(c); }));
    container.querySelectorAll("[data-tabs] button").forEach((btn) => btn.addEventListener("click", () => { c.tab = Number(btn.dataset.tab); container.querySelectorAll("[data-tabs] button").forEach((x) => x.classList.toggle("active", x === btn)); renderTab(c); if (!c.demo) window.scrollTo({ top: container.querySelector("[data-tabs]").offsetTop - 8, behavior: "smooth" }); }));
    renderTab(c);
    loadChart(c);
  }

  async function loadChart(c) {
    const el = c.root && c.root.querySelector("[data-chart]"); if (!el) return;
    const range = c.chartRange;
    const key = `${c.b.symbol}:${range}`;
    if (!c.chartCache[key]) {
      if (c.demo) return; // demo has every range preloaded
      el.innerHTML = `<div class="spinner">…</div>`;
      try { c.chartCache[key] = (await api(`/api/chart/${encodeURIComponent(c.b.symbol)}?range=${range}`)).points; }
      catch (e) { el.innerHTML = `<div class="error">${t("loadError")}</div>`; return; }
    }
    if (c.chartRange !== range) return;
    window.renderChart(el, c.chartCache[key], { locale: state.locale, height: el.clientWidth < 600 ? 280 : 360 });
  }

  function renderTab(c) {
    const body = c.root && c.root.querySelector("[data-tabbody]"); if (!body) return;
    body.innerHTML = [tabOverview, tabFinancials, tabValuation, tabHolders][c.tab](c);
    if (c.tab === 2) bindTarget(c);
  }

  // ---- small builders ----
  const sec = (title, inner, extra = "") => `<section class="card"><h3 class="sec">${title}${extra ? `<span class="sec-extra">${extra}</span>` : ""}</h3>${inner}</section>`;
  const kv = (rows) => `<dl class="kv2">${rows.filter((r) => r).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  const wrap = (table) => `<div class="tw">${table}</div>`;
  const row = (th, td, cls = "") => `<tr class="${cls}"><th class="rowh">${th}</th><td>${td}</td></tr>`;

  function aiBox(c, part) {
    const s = c.s;
    if (s && s[part]) return `<div class="ai"><span class="hl">${esc(s[part].headline)}</span><span class="body">${esc(s[part].body)}</span></div>`;
    if (c.summaryStatus === "pending" || c.summaryStatus === null) return `<span class="spinner">${t("generating")}</span>`;
    if (c.summaryStatus === "disabled") return `<span class="muted">${t("summaryDisabled")}</span>`;
    return `<span class="muted">${t("summaryError")}</span>`;
  }
  function updatedNote(c) {
    const s = c.s; if (!s) return "";
    const tr = (s.transcriptsUsed || [])[0];
    return `<p class="note">${esc(t("updatedNote", { period: tr ? tr.period : "—", date: tr ? fmtDate(tr.date) : "—", gen: fmtDate(s.generatedAt) }))}</p>`;
  }

  function financeBox(f) {
    if (!f) return "";
    const F = t("fin");
    const sgn = (v, d = 1) => (v === null || v === undefined ? NA : `${v > 0 ? "+" : ""}${fmtDec(v, d)}%`);
    const r = (k, v) => `<tr><th class="rowh">${k}</th><td class="num">${v}</td></tr>`;
    return `<table class="shk"><tr><th class="rowh"><b>【${t("financials")}】</b></th><th>&lt;${yymm(f.asOf)}&gt; ${t("unitM")}</th></tr>
      ${r(t("totalAssets"), fmtInt(f.totalAssets))}
      ${r(F.equityWithRatio, `${fmtInt(f.equity)} <span class="muted">(${fmtPct(f.equityRatioPct)})</span>`)}
      ${r(F.cash, fmtInt(f.cashAndShortTerm))}
      ${r(t("debt"), fmtInt(f.totalDebt))}
      ${r(F.netDebt, fmtInt(f.netDebt))}
      ${r(F.de, fmtDec(f.debtToEquity, 2))}
      ${r(F.debtEbitda, `${fmtDec(f.debtToEbitda, 1)}x`)}
      ${r(F.netDebtEbitda, f.netDebtToEbitda === null ? NA : `${fmtDec(f.netDebtToEbitda, 1)}x`)}
      ${r(F.interest, fmtInt(f.interestExpense))}
      ${r(F.coverage, f.interestCoverage === null ? (f.interestExpense === 0 ? "∞" : NA) : `${fmtDec(f.interestCoverage, 1)}x`)}
      ${r(F.interestBurden, fmtPct(f.interestToEbitPct))}
      ${r(F.avgRate, fmtPct(f.avgInterestRatePct, 2))}
      ${r(F.currentRatio, fmtDec(f.currentRatio, 2))}
      ${r(F.goodwill, `${fmtInt(f.goodwillIntangibles)} <span class="muted">(${fmtPct(f.goodwillPct)})</span>`)}
      ${r(F.shares, sgn(f.sharesChangePct))}
      ${r(F.roic, fmtPct(f.roicPct))}
    </table><p class="note">${esc(F.note.replace("{fy}", f.fiscalYear || ""))}</p>`;
  }

  function tabOverview(c) {
    const b = c.b; const co = b.company; const m = b.market; const v = b.valuation || {}; const f = b.financials;
    const feature = c.s ? esc(c.s.feature) : (c.summaryStatus === "pending" || c.summaryStatus === null ? `<span class="spinner">${t("generating")}</span>` : esc((co.businessSummary || co.description || "").slice(0, 240)));
    const rating = m.analystRating ? `${esc(m.analystRating.consensus)}（Buy ${m.analystRating.buy} / Hold ${m.analystRating.hold ?? 0} / Sell ${m.analystRating.sell}）` : NA;
    const target = m.analystTarget ? `$${fmtDec(m.analystTarget.consensus)}（$${fmtDec(m.analystTarget.low)}〜$${fmtDec(m.analystTarget.high)}）` : NA;
    const sg = (b.growth.salesGrowth || []).map((x) => `${esc(x.label)} ${x.pct !== null ? (x.pct >= 0 ? "+" : "") + fmtDec(x.pct, 1) + "%" : NA}`).join("　");
    const compList = c.s && c.s.competitors && c.s.competitors.length ? c.s.competitors : co.competitors;
    const compLink = (x) => (x.us === false ? `<span class="muted">${esc(x.symbol)}</span>` : `<a href="#/s/${esc(x.symbol)}">${esc(x.symbol)}</a>`);
    const comps = compList && compList.length ? compList.map((x) => `${compLink(x)} ${esc(x.name || "")}<span class="muted">（${fmtBig(x.marketCapM)}${x.country && x.country !== "US" ? ` · ${esc(x.country)}` : ""}）</span>`).join("、") : NA;
    return `<table class="shk">
      ${row(t("name"), `${esc(co.name)}${co.ceo ? `<span class="muted">　${t("ceo")}: ${esc(co.ceo)}</span>` : ""}`)}
      ${row(t("fiscalYear"), monthName(co.fiscalYearEndMonth))}
      ${row(t("ipo"), `${fmtDate(co.ipoDate, { month: "numeric", day: undefined })}${co.stateOfIncorporation ? `　<span class="muted">${t("incorporation")}: ${esc(co.stateOfIncorporation)}</span>` : ""}`)}
      ${row(t("feature"), feature)}
      ${row(t("segments"), co.segments.length ? co.segments.map((x) => `${esc(x.name)}${x.sharePct ?? "?"}`).join("、") + (co.segmentsFiscalYear ? ` <${co.segmentsFiscalYear}>` : "") : NA)}
      ${row(t("sector"), `${esc(co.sector || "")} / ${esc(co.industry || "")}${co.sicDescription ? `　<span class="muted">${t("sic")}: ${esc(co.sicDescription)} (${esc(co.sicCode)})</span>` : ""}`)}
      ${row(`<b>${t("longTerm")}</b>`, aiBox(c, "longTerm"))}
      ${row(`<b>${t("recent")}</b>`, aiBox(c, "recent"))}
      ${row(`<b>${t("bull")}</b>`, aiBox(c, "bull"))}
      ${row(`<b>${t("bear")}</b>`, aiBox(c, "bear"))}
      ${row(t("hq"), esc(co.address || NA))}
      ${row(t("employees"), co.employees ? `${fmtInt(co.employees)}${isCJK() ? "名" : ""}${co.employeesAsOf ? ` <${yymm(co.employeesAsOf)}>` : ""}` : NA)}
      ${row(t("exchange"), `${esc(co.exchangeFullName || co.exchange)}${co.filerCategory ? `　<span class="muted">${esc(co.filerCategory)}</span>` : ""}`)}
      ${row(t("url"), co.website ? `<a href="${esc(co.website)}" target="_blank" rel="noopener">${esc(co.website)}</a>` : NA)}
      ${row(t("shares"), `${t("sharesOut")} ${fmtInt(m.sharesOutstandingM)}${t("millionShares")}　${t("marketCap")} ${fmtBig(m.marketCapM)}　${t("val.peFwd")} ${fmtDec(v.peForward, 1)}　${t("val.pe")} ${fmtDec(v.pe, 1)}　${t("pbr")} ${fmtDec(m.pbr, 1)}　${t("val.divYield")} ${fmtPct(m.dividendYieldPct, 2)}`)}
      ${row(t("opMargin"), `${fmtPct(b.growth.operatingMarginPct)}${b.growth.operatingMarginPrevPct !== null ? `(${b.growth.operatingMarginPct - b.growth.operatingMarginPrevPct >= 0 ? "+" : ""}${fmtDec(b.growth.operatingMarginPct - b.growth.operatingMarginPrevPct, 1)}pt)` : ""}　<span class="muted">${t("salesGrowth3y")}:</span> ${sg || NA}`)}
      ${row(t("competitors"), comps)}
      ${row(t("nextEarnings"), `${fmtDate(b.nextEarnings)}　<span class="muted">${t("analysts")}: ${rating}　${t("target")}: ${target}</span>`)}
    </table>
    ${updatedNote(c)}
    ${financeBox(f)}`;
  }

  function tabFinancials(c) {
    const b = c.b;
    const rows = b.performance.map((r, i, arr) => {
      const prefix = r.kind === "annual" ? "FY" : r.kind === "estimate" ? `${t("estimate")} ` : "";
      const cls = r.kind === "estimate" ? "est" : r.kind === "quarter" ? "quarter" : "";
      const sep = i > 0 && arr[i - 1].kind !== r.kind ? " sep" : "";
      return `<tr class="${cls}${sep}"><th>${prefix}${esc(r.label)}</th><td class="num">${fmtInt(r.revenue)}</td><td class="num">${fmtInt(r.operatingIncome)}</td><td class="num">${fmtInt(r.pretaxIncome)}</td><td class="num">${fmtInt(r.netIncome)}</td><td class="num">${fmtDec(r.eps)}</td><td class="num">${r.dps === null ? (r.kind === "annual" ? "0" : NA) : fmtDec(r.dps)}</td></tr>`;
    }).join("");
    const estN = (b.performance.find((r) => r.kind === "estimate") || {}).analysts;
    const d = b.dividends; const ind = b.indicators; const cf = b.cashflow; const f = b.financials;
    const pair = (a, p) => `${fmtInt(a)}${p !== null && p !== undefined ? ` <span class="muted">(${fmtInt(p)})</span>` : ""}`;
    const perf = wrap(`<table class="tbl"><thead><tr><th></th><th class="num">${t("revenue")}</th><th class="num">${t("opIncome")}</th><th class="num">${t("pretax")}</th><th class="num">${t("netIncome")}</th><th class="num">${t("eps")}</th><th class="num">${t("dps")}</th></tr></thead><tbody>${rows}</tbody></table>`) + `<p class="note">${t("unitM")}${estN ? ` · ${t("estimateNote", { n: estN })}` : ""}</p>`;
    const divs = wrap(`<table class="tbl"><thead><tr><th>${t("exDate")}</th><th class="num">${t("dividendAmount")}</th></tr></thead><tbody>${d.history.map((x) => `<tr><th>${yymm(x.date)}</th><td class="num">${fmtDec(x.amount)}</td></tr>`).join("") || `<tr><td colspan="2" class="c">${NA}</td></tr>`}</tbody></table>`) + kv([[t("yieldLabel"), fmtPct(d.yieldPct, 2)], [t("bps"), fmtDec(b.market.bps)]]);
    const indic = kv([
      [t("roe"), `${fmtPct(ind.roePct)} <span class="muted">${t("ttm")} ${fmtPct(ind.roeTTMPct)}</span>`],
      [t("roa"), `${fmtPct(ind.roaPct)} <span class="muted">${t("ttm")} ${fmtPct(ind.roaTTMPct)}</span>`],
      [`${t("maxNet")}${ind.maxNetIncome ? ` (${esc(ind.maxNetIncome.label)})` : ""}`, ind.maxNetIncome ? fmtInt(ind.maxNetIncome.value) : NA],
      [t("capex"), pair(ind.capex, ind.capexPrev)], [t("depreciation"), pair(ind.depreciation, ind.depreciationPrev)], [t("rnd"), pair(ind.rnd, ind.rndPrev)],
    ]) + `<p class="note">${t("unitM")} · ( ) = ${isCJK() ? "前期" : "prior year"}</p>`;
    const cfl = cf ? kv([[t("opCF"), pair(cf.operating, cf.operatingPrev)], [t("invCF"), pair(cf.investing, cf.investingPrev)], [t("finCF"), pair(cf.financing, cf.financingPrev)], [t("cashEq"), pair(cf.cash, cf.cashPrev)], [t("fcf"), fmtInt(cf.freeCashFlow)], [t("buyback"), fmtInt(cf.buybacks)], [t("divPaid"), fmtInt(cf.dividendsPaid)]]) + `<p class="note">FY${esc(cf.fiscalYear)} · ${t("unitM")}</p>` : NA;
    const bal = financeBox(f) || NA;
    return `<div class="grid2">${sec(t("performance"), perf)}${sec(t("dividends"), divs)}</div>
      <div class="grid2b">${sec(t("indicators"), indic, ind.fiscalYear ? `FY${esc(ind.fiscalYear)}` : "")}${sec(t("cashflow"), cfl)}</div>
      ${bal}`;
  }

  function tabHolders(c) {
    const b = c.b; const h = b.holders; const p = b.prices;
    const holders = wrap(`<table class="tbl"><thead><tr><th>${t("holderName")}</th><th class="num">${t("holderShares")}</th></tr></thead><tbody>${h.holders.length ? h.holders.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${fmtDec(x.sharesM, 1)} (${fmtDec(x.ownershipPct, 1)}%)</td></tr>`).join("") : `<tr><td colspan="2" class="c">${NA}</td></tr>`}</tbody></table>`)
      + `<p class="note">${h.asOf ? t("holdersAsOf", { date: h.asOf }) : ""}${h.summary ? ` · ${t("investorsHolding")} ${fmtInt(h.summary.investorsHolding)} · ${t("instOwnership")} ${fmtPct(h.summary.ownershipPct)}` : ""} · ${t("freeFloat")} ${fmtPct(b.market.freeFloatPct)} · ${t("insiders")}: ${b.insider ? t("insiderNote", { b: b.insider.purchases ?? 0, s: b.insider.sales ?? 0 }) : NA}</p>`;
    const officers = b.officers.length ? `<ul class="officers">${b.officers.map((o) => `<li><b>${esc(o.name)}</b><span class="muted">${esc(o.title)}</span></li>`).join("")}</ul>` : NA;
    const caps = b.capitalChanges.filter((x) => x.date >= new Date(Date.now() - 10 * 366 * 86400000).toISOString().slice(0, 10));
    const capRows = caps.length ? caps.map((x) => `<tr><th>${yymm(x.date)}</th><td>${x.numerator >= x.denominator ? t("split", { a: x.denominator, b: x.numerator }) : t("reverseSplit", { a: x.denominator, b: x.numerator })}</td></tr>`).join("") : `<tr><td colspan="2" class="muted">${t("noSplits")}</td></tr>`;
    const yearly = p.yearly.map((r) => `<tr><th>${esc(r.label)}</th><td class="num">${fmtDec(r.high)} <span class="muted">(${esc(r.highNote)})</span></td><td class="num">${fmtDec(r.low)} <span class="muted">(${esc(r.lowNote)})</span></td></tr>`).join("");
    const monthly = p.monthly.map((r) => `<tr><th>${r.partial ? "#" : ""}${esc(r.label)}</th><td class="num">${fmtDec(r.high)}</td><td class="num">${fmtDec(r.low)}</td><td class="num">${fmtInt(r.volumeM)}</td></tr>`).join("");
    const prices = wrap(`<table class="tbl"><thead><tr><th></th><th class="num">${t("high")}</th><th class="num">${t("low")}</th></tr></thead><tbody>${yearly}</tbody></table>`) + `<p class="note">${t("priceNote1")}</p>` +
      wrap(`<table class="tbl"><thead><tr><th></th><th class="num">${t("high")}</th><th class="num">${t("low")}</th><th class="num">${t("volume")}</th></tr></thead><tbody>${monthly}</tbody></table>`);
    const filings = b.filings.map((x) => `<tr><th>${esc(x.filingDate)}</th><td><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.form)}</a> <span class="muted">${esc(x.description || "")}</span></td></tr>`).join("");
    const events = b.materialEvents.map((e) => `<tr><th>${esc(e.filingDate)}</th><td>${esc(e.form)} · ${esc(e.items.join(", "))}</td></tr>`).join("");
    return `<div class="grid2">${sec(t("holders"), holders)}${sec(t("officers"), officers)}</div>
      <div class="grid2b">${sec(t("capitalChanges"), wrap(`<table class="tbl"><tbody>${capRows}</tbody></table>`) + prices)}
      ${sec(t("filings"), wrap(`<table class="tbl"><tbody>${filings || `<tr><td class="c">${NA}</td></tr>`}</tbody></table>`)) + (events ? sec(t("events"), wrap(`<table class="tbl"><tbody>${events}</tbody></table>`)) : "")}</div>`;
  }

  function tabValuation(c) {
    const b = c.b; const v = b.valuation; const d = b.dcf; const V = t("val");
    if (!v) return `<p class="muted">${NA}</p>`;
    const x = (n, dgt = 1) => fmtDec(n, dgt);
    const groups = [
      [V.multiples, [[V.pe, x(v.pe)], [V.peFwd, x(v.peForward)], [V.peFwd2, x(v.peForward2)], [V.peg, x(v.peg, 2)], [V.ps, x(v.ps)], [V.pb, x(v.pb)], [V.pfcf, x(v.pfcf)], [V.pocf, x(v.pocf)]]],
      [V.ev, [[V.marketCap, fmtBig(v.marketCapM)], [V.ev, fmtBig(v.enterpriseValueM)], [V.evSales, x(v.evSales)], [V.evEbitda, x(v.evEbitda)], [V.evOcf, x(v.evOcf)], [V.evFcf, x(v.evFcf)]]],
      [V.yields, [[V.earningsYield, fmtPct(v.earningsYieldPct)], [V.fcfYield, fmtPct(v.fcfYieldPct)], [V.divYield, fmtPct(v.dividendYieldPct, 2)], [V.payout, fmtPct(v.payoutPct)], [V.epsTTM, `$${x(v.epsTTM, 2)}`], [V.epsFwd, `$${x(v.epsForward, 2)}`], [V.epsFwd2, `$${x(v.epsForward2, 2)}`], [V.epsGrowth, fmtPct(v.epsGrowthFwdPct)], [V.bvps, `$${x(v.bvps, 2)}`], [V.fcfps, `$${x(v.fcfps, 2)}`], [V.rps, `$${x(v.revenuePerShare, 2)}`]]],
      [V.quality, [[V.gm, fmtPct(v.grossMarginPct)], [V.om, fmtPct(v.opMarginPct)], [V.nm, fmtPct(v.netMarginPct)], [V.roe, fmtPct(v.roePct)], [V.roic, fmtPct(v.roicPct)], [V.roa, fmtPct(v.roaPct)], [V.ndEbitda, x(v.netDebtEbitda, 2)], [V.de, x(v.debtEquity, 2)], [V.cov, x(v.interestCoverage)], [V.cr, x(v.currentRatio, 2)]]],
      [V.market, [[V.beta, x(v.beta, 2)], [t("tech").high52, `$${x(v.yearHigh, 2)}${v.yearHighDate ? ` <span class="muted">(${fmtDate(v.yearHighDate)})</span>` : ""}`], [t("tech").low52, `$${x(v.yearLow, 2)}${v.yearLowDate ? ` <span class="muted">(${fmtDate(v.yearLowDate)})</span>` : ""}`], v.allTimeHigh ? [t("tech").ath, `$${x(v.allTimeHigh.price, 2)} <span class="muted">(${fmtDate(v.allTimeHigh.date)})</span>`] : null, [V.ma, `$${x(v.priceAvg50, 2)} / $${x(v.priceAvg200, 2)}`], [V.target, v.analystTarget ? `$${x(v.analystTarget.consensus, 2)} (${v.analystTarget.upsidePct >= 0 ? "+" : ""}${x(v.analystTarget.upsidePct)}%)` : NA]]],
    ];
    const metrics = `<div class="grid3">${groups.map(([title, rows]) => sec(title, kv(rows))).join("")}</div>`;
    let dcfHtml;
    if (!d) dcfHtml = `<p class="muted">${V.noDcf}</p>`;
    else {
      const I = d.inputs; const up = d.upsidePct;
      const head = `<div class="dcf-head"><div class="dcf-value"><div class="stat-l">${V.perShare}</div><div class="dcf-num">$${x(d.perShare, 2)}</div><div class="${up >= 0 ? "up" : "down"}">${V.vsPrice} ${up >= 0 ? "+" : ""}${x(up)}% <span class="muted">($${x(d.price, 2)})</span></div></div>
        ${kv([[V.evLabel, fmtBig(d.enterpriseValue / 1e6)], [V.equity, fmtBig(d.equityValue / 1e6)], [V.terminalShare, fmtPct(d.terminalShare * 100, 0)], [V.wacc, fmtPct(I.wacc, 2)], [V.g, fmtPct(I.g, 2)], [V.costEquity, `${fmtPct(I.costEquity, 2)} <span class="muted">(${V.rf} ${fmtPct(I.riskFree, 2)} + β ${x(I.beta, 2)} × ${V.erp} ${fmtPct(I.erp, 1)})</span>`], [V.costDebt, `${fmtPct(I.costDebt, 2)} <span class="muted">(${fmtPct(I.weightDebt * 100, 1)} ${isCJK() ? "ウェイト" : "weight"})</span>`], [V.s2c, x(I.salesToCapital, 2)], [V.tax, `${fmtPct(I.taxRate)} → ${fmtPct(I.marginalTax, 0)}`]])}</div>`;
      const yrs = wrap(`<table class="tbl"><thead><tr><th>${V.year}</th><th class="num">${V.rev}</th><th class="num">${V.ebit}</th><th class="num">${V.margin}</th><th class="num">${V.reinvest}</th><th class="num">${V.fcff}</th><th class="num">${V.pv}</th></tr></thead><tbody>${d.years.map((y) => `<tr class="${y.source === "consensus" ? "est" : ""}"><th>FY${esc(y.label)} <span class="muted small">${y.source === "consensus" ? V.consensus : V.extrap}</span></th><td class="num">${fmtInt(y.revenue / 1e6)}</td><td class="num">${fmtInt(y.ebit / 1e6)}</td><td class="num">${fmtPct(y.margin * 100)}</td><td class="num">${fmtInt(y.reinvestment / 1e6)}</td><td class="num">${fmtInt(y.fcff / 1e6)}</td><td class="num">${fmtInt(y.pv / 1e6)}</td></tr>`).join("")}<tr class="sep"><th>${V.terminal}</th><td colspan="5" class="num muted">${fmtInt(d.terminalValue / 1e6)}</td><td class="num">${fmtInt(d.pvTerminal / 1e6)}</td></tr></tbody></table>`) + `<p class="note">${t("unitM")}</p>`;
      const S = d.sensitivity;
      const sens = S ? wrap(`<table class="tbl sens"><thead><tr><th>WACC \\ g</th>${S.gs.map((g) => `<th class="num">${fmtPct(g, 1)}</th>`).join("")}</tr></thead><tbody>${S.grid.map((r, i) => `<tr><th>${fmtPct(S.waccs[i], 1)}</th>${r.map((val, j) => `<td class="num ${i === 1 && j === 1 ? "base" : ""}">${val === null ? NA : "$" + x(val, 0)}</td>`).join("")}</tr>`).join("")}</tbody></table>`) + `<p class="note">${V.sensNote}</p>` : "";
      dcfHtml = head + yrs + `<h4 class="sub">${V.sens}</h4>` + sens + `<details class="method"><summary>${V.method}</summary>${V.methodBody.map((para) => `<p>${esc(para)}</p>`).join("")}</details>`;
    }
    const T = t("tp");
    const eps = v.epsNtm || v.epsForward;
    let targetHtml = `<p class="muted">${NA}</p>`;
    if (eps && v.price) {
      let saved = null; try { saved = Number(localStorage.getItem(`tpe:${b.symbol}`)) || null; } catch {}
      const def = saved || (v.peForward ? Math.round(v.peForward) : 20);
      const refs = [[V.pe, v.pe], [V.peFwd, v.peForward], [V.peFwd2, v.peForward2]].filter((r) => r[1]).map((r) => `${r[0]} ${fmtDec(r[1], 1)}`).join(" · ");
      targetHtml = `<div class="target"><dl class="kv2"><dt>${T.epsNtm}</dt><dd>$${fmtDec(eps, 2)}</dd>
        <dt><label for="tpe-${esc(b.symbol)}">${T.multiple}</label></dt><dd><input id="tpe-${esc(b.symbol)}" class="tpe" type="number" min="1" max="500" step="0.5" value="${def}" inputmode="decimal"> <span class="muted small">${T.presets}: ${refs}</span></dd>
        <dt>${T.price}</dt><dd><b class="tp-price"></b> <span class="tp-up"></span></dd></dl><p class="note">${esc(T.note)}</p></div>`;
    }
    const K = t("tech"); const tech = c.s && c.s.technical;
    const lv = (rows) => rows && rows.length ? `<table class="tbl"><thead><tr><th class="num">${K.level}</th><th>${K.reason}</th></tr></thead><tbody>${rows.slice().sort((p, q) => q.level - p.level).map((r) => `<tr><td class="num">$${fmtDec(r.level, 1)}</td><td>${esc(r.reason)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">${NA}</p>`;
    const techHtml = tech
      ? `<div class="grid2b"><div><h4 class="sub">${K.resistance}</h4>${wrap(lv(tech.resistance))}</div><div><h4 class="sub">${K.support}</h4>${wrap(lv(tech.support))}</div></div><p class="tech-comment">${esc(tech.comment)}</p>`
      : `<p class="muted">${c.summaryStatus === "pending" || c.summaryStatus === null ? t("generating") : t("summaryError")}</p>`;
    return `${sec(T.title, targetHtml)}${sec(K.title, techHtml, `$${fmtDec(v.price, 2)}`)}${sec(V.dcfTitle, dcfHtml, d && d.riskFreeDate ? `${V.rf}: ${fmtPct(d.inputs.riskFree, 2)} (${esc(d.riskFreeDate)})` : "")}<h3 class="sec plain">${V.title}</h3>${metrics}`;
  }
  function bindTarget(c) {
    const root = c.root; if (!root) return;
    const input = root.querySelector("input.tpe"); if (!input) return;
    const v = c.b.valuation; const eps = v.epsNtm || v.epsForward;
    const update = () => {
      const m = Number(input.value);
      const priceEl = root.querySelector(".tp-price"); const upEl = root.querySelector(".tp-up");
      if (!m || m <= 0) { priceEl.textContent = NA; upEl.textContent = ""; return; }
      const tp = m * eps; const up = (tp / v.price - 1) * 100;
      priceEl.textContent = `$${fmtDec(tp, 2)}`;
      upEl.textContent = `${t("tp").upside} ${up >= 0 ? "+" : ""}${fmtDec(up, 1)}%`;
      upEl.className = `tp-up ${up >= 0 ? "up" : "down"}`;
      try { localStorage.setItem(`tpe:${c.b.symbol}`, String(m)); } catch {}
    };
    input.addEventListener("input", update);
    update();
  }

  // ---------- AI summary polling ----------
  function stopSummaryPolling(c) { if (c && c.timer) clearTimeout(c.timer); if (c) c.timer = null; }
  function applySummary(c, r, lang) {
    c.summaryStatus = r.status;
    if (r.status === "ready") { c.s = r.summary; c.tries = 0; }
    if (c.root && (c.tab === 0 || c.tab === 2)) renderTab(c);
    if (r.status === "pending" && c.tries < 40) { c.tries++; c.timer = setTimeout(() => loadSummary(c), 6000); }
  }
  async function loadSummary(c) {
    stopSummaryPolling(c);
    const symbol = c.b && c.b.symbol; const lang = state.locale;
    if (!symbol) return;
    if (!state.config.summariesEnabled) { c.summaryStatus = "disabled"; if (c.root && c.tab === 0) renderTab(c); return; }
    try {
      const r = c.demo ? (await api(`/api/demo?lang=${encodeURIComponent(lang)}`)).summary : await api(`/api/summary/${encodeURIComponent(symbol)}?lang=${encodeURIComponent(lang)}`);
      if (c.b.symbol !== symbol || lang !== state.locale) return;
      applySummary(c, r, lang);
    } catch (e) {
      c.summaryStatus = "error"; if (c.root && c.tab === 0) renderTab(c);
    }
  }

  // ---------- landing sample (live page, no login) ----------
  async function mountDemo(container) {
    const c = state.demo;
    stopSummaryPolling(c);
    container.innerHTML = `<div class="spinner">…</div>`;
    try {
      const r = await api(`/api/demo?lang=${encodeURIComponent(state.locale)}`);
      c.b = r.bundle; c.s = null; c.summaryStatus = null; c.tab = 0;
      c.chartCache = Object.fromEntries(Object.entries(r.charts).map(([k, pts]) => [`${r.bundle.symbol}:${k}`, pts]));
      if (!document.body.contains(container)) return;
      mountStock(container, c);
      applySummary(c, r.summary, state.locale);
    } catch (e) {
      container.innerHTML = `<div class="error">${t("loadError")}</div>`;
    }
  }

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
    try { state.config = await api("/api/config"); } catch { state.config = { locales: ["ja", "en"], defaultLocale: "ja", trialDays: 7, priceLabel: "US$10 / month", billingEnabled: false, summariesEnabled: false }; }
    try { const me = await api("/api/auth/me"); state.user = me.user; state.ent = me.entitlement; } catch {}
    let loc = null;
    try { loc = localStorage.getItem("locale"); } catch {}
    if (!loc && state.user) loc = state.user.locale;
    if (!loc) loc = state.config.defaultLocale; // site default (Japanese on the JP site), never the browser language
    state.route = parseRoute();
    applyBrand();
    setLocale(loc, false);
  }
  init();
})();
