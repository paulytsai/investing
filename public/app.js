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
    if (typeof v === "string" && v.includes("{currency}")) v = v.split("{currency}").join(currencyName());
    if (typeof v === "string" && v.includes("{trial")) { const days = (state.config && state.config.trialDays) || 7; v = v.split("{trialSpan}").join(window.trialSpan(days, state.locale)).split("{trial}").join(window.trialLabel(days, state.locale)); }
    // Whole blocks (landing, teaser, billing ...) get the same substitutions in every string.
    if (v && typeof v === "object") { const days = (state.config && state.config.trialDays) || 7; v = JSON.parse(JSON.stringify(v).split("{brand}").join(brandName()).split("{trialSpan}").join(window.trialSpan(days, state.locale)).split("{trial}").join(window.trialLabel(days, state.locale)).split("{currency}").join(currencyName())); }
    return v;
  }
  const brandName = () => (state.config && state.config.brand && state.config.brand.name) || "Kabukaizu";
  const currencyName = () => { const c = (state.config && state.config.priceCurrency) || "USD"; const names = (window.CURRENCY_NAMES || {})[state.locale] || {}; return names[c] || c; };
  // " in Japanese and English" on a two-language site, nothing on a single-language one (English copy only).
  // Annual plan line: "¥26,550 / year (25% off, ¥2,213 a month)" when the site offers one.
  const annualInfo = () => { const a = state.config && state.config.annual; const m = state.config && state.config.priceAmount; if (!a || !m) return null; const yearly = Number(a.amount); const pct = Math.round((1 - yearly / (12 * m)) * 100); const sym = String(state.config.priceLabel || "").replace(/[\d.,\s]/g, ""); const perMonth = yearly / 12; const dec = state.config.priceCurrency === "JPY" || state.config.priceCurrency === "TWD" ? 0 : 2; return { label: a.label, pct, perMonth: `${sym}${perMonth.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })}` }; };
  const langsNote = () => { const ls = (state.config && state.config.locales) || []; return ls.length > 1 ? ` in ${ls.map((l) => window.LOCALE_NAMES_EN[l] || l).join(" and ")}` : ""; };
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
    if (state.stock.b) { state.stock.s = null; state.stock.summaryStatus = null; state.stock.d = null; state.stock.deepStatus = null; }
    if (state.demo.b) { state.demo.s = null; state.demo.summaryStatus = null; state.demo.d = null; state.demo.deepStatus = null; }
    $("#searchInput").placeholder = t("searchPlaceholder");
    $("#searchBtn").textContent = t("search");
    $("#sectorsBtn").textContent = t("sectors.button");
    // Visitors: the choice lasts for this browser session only, so a new visit opens in the site
    // language (Japanese on kabukaizu.com). Members: the choice is saved on the account below.
    try { sessionStorage.setItem("locale", loc); localStorage.removeItem("locale"); } catch {}
    if (persist) track("lang", loc);
    if (persist && state.user && state.user.locale !== loc) api("/api/auth/locale", { method: "POST", body: { locale: loc } }).then((r) => { state.user = r.user; }).catch(() => {});
    renderUserMenu();
    render();
  }

  // ---------- usage tracking (what each member does on the page; admin traffic is dropped server-side) ----------
  const TAB_KEYS = ["overview", "financials", "valuation", "technical", "holders", "deep"];
  function track(action, detail) {
    try { if (state.user && state.user.role === "admin") return; fetch("/api/track", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ action, detail: String(detail || "").slice(0, 40) }) }).catch(() => {}); } catch {}
  }
  let lastTrackedPage = null;
  function trackPage(view) {
    const key = `${view}|${location.hash}`; if (key === lastTrackedPage) return; lastTrackedPage = key;
    if (view !== "stock") track("page", view); // stock pages are logged by the data request itself
  }

  // ---------- user menu ----------
  function renderUserMenu() {
    const langs = state.config.locales.length > 1
      ? `<span class="lang">${state.config.locales.map((l) => `<button data-lang="${l}" class="${l === state.locale ? "active" : ""}">${window.LOCALE_NAMES[l]}</button>`).join("")}</span>`
      : "";
    let right = "";
    if (state.user) {
      right = `${entPill()}${state.user.role === "admin" ? `<a href="#/admin">${t("billing.adminPanel")}</a>` : ""}<a href="#/account">${esc(state.user.username)}</a><button class="btn small" id="logoutBtn">${t("logout")}</button>`;
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
    if (e.state === "admin") return `<span class="pill">${t("billing.admin")}</span>`;
    if (e.state === "complimentary") return `<span class="pill">${t("billing.complimentary")}</span>`;
    if (e.state === "trial") return `<span class="pill warn">${t("trialDaysLeft", { n: e.daysLeft })}</span>`;
    if (e.state === "subscribed") return `<span class="pill">${t("subscribed")}</span>`;
    if (e.state === "cancelled_grace") return `<span class="pill warn">${t("cancelledGrace", { date: fmtDate(e.endsAt) })}</span>`;
    return `<span class="pill warn">${t(e.state === "lapsed" ? "lapsed" : "trialExpired")}</span>`;
  }

  // ---------- routing ----------
  function parseRoute() {
    const pm = !location.hash && location.pathname.match(/^\/s\/([A-Za-z0-9.\-]+)\/?$/);
    if (pm) return { view: "stock", symbol: decodeURIComponent(pm[1]).toUpperCase(), ssr: true };
    const h = location.hash.replace(/^#\/?/, "").split("?")[0];
    const [a, b, c] = h.split("/");
    if (a === "s" && b) return { view: "stock", symbol: decodeURIComponent(b).toUpperCase() };
    if (a === "admin" && b === "user" && c) return { view: "adminUser", username: decodeURIComponent(c) };
    if (a === "reset" && b) return { view: "reset", token: b };
    if (a === "sector" && b) return { view: "sector", id: decodeURIComponent(b) };
    if (a === "sectors") return { view: "sectors" };
    if (["login", "signup", "account", "subscribe", "admin", "forgot", "contact", "about"].includes(a)) return { view: a };
    return { view: "home" };
  }
  window.addEventListener("hashchange", () => { state.route = parseRoute(); render(); });
  // /?coupon=CODE or /#/signup?coupon=CODE from a marketing link: remember the code for checkout.
  {
    const m = (location.search + " " + location.hash).match(/[?&]coupon=([A-Za-z0-9_-]{1,40})/);
    if (m) { try { localStorage.setItem("coupon", JSON.stringify({ code: m[1].toUpperCase(), pending: true })); } catch {} }
  }

  function render() {
    const r = state.route;
    trackPage(r.view);
    if (r.view === "adminUser") return state.user && state.user.role === "admin" ? renderAdminUser(r.username) : renderAuth("login");
    if (r.view === "login") return renderAuth("login");
    if (r.view === "signup") return renderAuth("signup");
    if (r.view === "forgot") return renderForgot();
    if (r.view === "contact") return renderContact();
    if (r.view === "about") return renderAbout();
    if (r.view === "sectors") return renderSectors();
    if (r.view === "sector") return renderSector(r.id);
    if (r.view === "reset") return renderReset(r.token);
    if (r.view === "account") return state.user ? renderAccount() : renderAuth("login");
    if (r.view === "subscribe") return renderPaywall();
    if (r.view === "admin") return state.user && state.user.role === "admin" ? renderAdmin() : renderAuth("login");
    if (r.view === "stock") return state.user ? loadStock(r.symbol) : renderTeaser(r.symbol);
    return renderHome();
  }

  // ---------- views ----------
  function renderHome() {
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
    const price = state.config.priceLabel;
    if (!state.user) {
      const days = (state.config && state.config.trialDays) || 7;
      const L = JSON.parse(JSON.stringify(t("landing")).split("{brand}").join(brandName()).split("{trialSpan}").join(window.trialSpan(days, state.locale)).split("{trial}").join(window.trialLabel(days, state.locale)));
      app.innerHTML = `
      <section class="hero hero-wave"><img class="hero-seal" src="${esc((state.config.brand && state.config.brand.sealImage) || "/img/seal.png")}" alt="${esc((state.config.brand && state.config.brand.seal) || "株海図")}"><div class="hero-inner"><div class="brand"><span class="brand-text"><span class="brand-name">${esc(brandName())}</span><span class="brand-sub">${esc((state.config.brand && state.config.brand.sub) || "US Stock Almanac")}</span></span></div>
        <h1>${esc(L.heroTitle)}</h1><p class="lead">${esc(L.heroLead)}</p>
        <div class="actions"><a class="btn primary big" href="#/signup">${esc(L.ctaPrimary)}</a><a class="btn big" href="#/login">${esc(L.ctaSecondary)}</a></div>
        <p class="small"><span class="pill ok">${esc(L.noCard)}</span> ${esc(L.ctaNote.replace("{price}", price))}</p>
      </div><span class="hero-credit">${esc(t("heroCredit"))}</span></section>
      <section class="land">
        <h2>${esc(L.samplesTitle)}</h2><p class="lead">${esc(L.samplesLead)}</p>
        <div class="demo-frame" data-demo></div>
      </section>
      <div class="land-row">
      <section class="land spec">
        <h2>${esc(L.spec.title)}</h2><p class="lead">${esc(L.spec.lead)}</p>
        <ul class="spec-list">${L.spec.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      </section>
      <section class="land pricing">
        <h2>${esc(L.pricingTitle)}</h2>
        <div class="pricecard"><div class="plan">${esc(L.pricingPlan)}</div><div class="amount">${esc(price)} <span class="per">${esc(t("perMonth"))}</span></div>
          ${annualInfo() ? `<div class="annual-line">${esc(t("annual.line", { price: annualInfo().label, pct: annualInfo().pct, perMonth: annualInfo().perMonth }))}</div>` : ""}
          <ul>${L.pricingBullets.map((b) => `<li>${esc(b.replace("{langs}", langsNote()))}</li>`).join("")}</ul>
          <a class="btn primary big" href="#/signup">${esc(L.ctaPrimary)}</a>
          <p class="muted small">${esc(L.pricingNote.split("{currency}").join(currencyName()).split("{provider}").join(state.config.billingProvider === "stripe" ? "Stripe" : "Lemon Squeezy"))}</p></div>
      </section>
      </div>
      <section class="land bio">
        <h2>${esc(L.bio.title)}</h2>
        <div class="bio-row"><img class="bio-photo" src="/img/paul-tsai.jpg" alt="${esc(L.bio.name)}" loading="lazy" width="240" height="320">
          <div class="bio-text"><h3>${esc(L.bio.name)} <span class="muted">${esc(L.bio.role)}</span></h3>
          ${L.bio.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}
          <p class="muted small">${esc(L.bio.book)} · <a href="https://paultsai.net" target="_blank" rel="noopener">paultsai.net</a></p></div></div>
      </section>
      <div class="footer center">${esc(L.disclaimer)}<br><a href="#/about">${t("about.link")}</a> · <a href="#/contact">${t("contact.link")}</a></div>`;
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
      ${isSignup ? `<p class="muted">${t("trialNote", { price: state.config.priceLabel })}</p><p class="nocard"><span class="pill ok">${esc(t("landing.noCard"))}</span> ${esc(t("landing.ctaNote").replace("{price}", state.config.priceLabel))}</p>` : ""}
      <div id="formError"></div>
      <form id="authForm">
        ${isSignup ? `<label>${t("username")}<input name="username" required minlength="3" maxlength="32" autocomplete="username"></label>
        <label>${t("email")}<input name="email" type="email" required autocomplete="email"></label>` : `<label>${t("loginId")}<input name="login" required autocomplete="username"></label>`}
        <label>${t("password")}<input name="password" type="password" required minlength="8" autocomplete="${isSignup ? "new-password" : "current-password"}"></label>
        <button class="btn primary" type="submit">${t(isSignup ? "createAccount" : "login")}</button>
      </form>
      <div class="alt">${isSignup ? `${t("haveAccount")} <a href="#/login">${t("login")}</a>` : `${t("noAccount")} <a href="#/signup">${t("signup")}</a><br><a href="#/forgot">${t("pw.forgot")}</a>`}</div></div>`;
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
        const target = back || (state.route.view === "stock" && state.route.symbol ? `#/s/${state.route.symbol}` : "#/s/AAPL");
        location.hash = target;
        if (location.hash === target) { state.route = parseRoute(); render(); }
      } catch (e) {
        $("#formError").innerHTML = `<div class="error">${esc(t(`errors.${e.code}`) !== `errors.${e.code}` ? t(`errors.${e.code}`) : e.message)}</div>`;
        btn.disabled = false;
      }
    });
  }

  function statusLine() {
    const e = state.ent;
    if (!e) return "";
    if (e.state === "admin") return t("billing.admin");
    if (e.state === "complimentary") return t("billing.complimentary");
    if (e.state === "trial") return t("trialDaysLeft", { n: e.daysLeft }) + ` (${fmtDate(new Date(e.trialEndsAt).toISOString())})`;
    if (e.state === "subscribed") return `${t("subscribed")}${e.renewsAt ? ` · ${fmtDate(e.renewsAt)}` : ""}`;
    if (e.state === "cancelled_grace") return t("cancelledGrace", { date: fmtDate(e.endsAt) });
    return t(e.state === "lapsed" ? "lapsed" : "trialExpired");
  }

  async function renderTeaser(symbol) {
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
    const K = t("teaser");
    if (!(app.dataset.ssr === symbol && app.querySelector(".teaser"))) app.innerHTML = `<div class="panel spinner">${esc(symbol)} …</div>`;
    let d;
    try { d = await api(`/api/teaser/${encodeURIComponent(symbol)}?lang=${encodeURIComponent(state.locale)}`); }
    catch (e) { app.innerHTML = `<div class="panel"><div class="error">${t(e.status === 404 || e.code === "not_a_company" || e.code === "invalid_symbol" ? "notFound" : "loadError")}</div></div>`; return; }
    if (state.route.symbol !== symbol) return;
    const c = d.company, m = d.market; const chg = m.change ?? 0; const sign = chg > 0 ? "+" : "";
    document.title = `${c.name} (${symbol}) | ${t("siteName")}`;
    const kv = [[K.price, m.price != null ? `$${fmtDec(m.price, 2)} <span class="${chg > 0 ? "up" : chg < 0 ? "down" : ""}">${sign}${fmtDec(m.changePct, 2)}%</span>` : NA], [t("marketCap"), fmtBig(m.marketCapM)], [t("val.peFwd"), fmtDec(m.peForward, 1)], [t("pbr"), fmtDec(m.pbr, 1)], [t("val.divYield"), fmtPct(m.dividendYieldPct, 2)], [t("tech").high52 + " / " + t("tech").low52, m.yearHigh != null ? `$${fmtDec(m.yearHigh, 2)} / $${fmtDec(m.yearLow, 2)}` : NA], [t("sector"), `${esc(c.sector || "")} / ${esc(c.industry || "")}`], [t("exchange"), esc(c.exchange || "")], [t("indexMember"), c.indices && c.indices.length ? c.indices.map((x) => `<b>${esc(x.index)}</b>${x.weightPct != null ? ` ${fmtDec(x.weightPct, 2)}%` : ""}`).join("　") : NA]];
    app.innerHTML = `<article class="teaser panel"><p class="pill">${K.preview}</p>
      <h1>${esc(c.name)} <span class="muted">(${esc(symbol)}) · ${esc(c.exchange || "")}</span></h1>
      ${d.feature ? `<h2 class="sub">${t("feature")}</h2><p class="feature">${esc(d.feature)}</p>` : c.description ? `<h2 class="sub">${t("feature")}</h2><p class="feature">${esc(c.description.slice(0, 600))}</p>` : ""}
      ${d.story ? `<h2 class="sub">${t("story")}</h2><div class="deep-story"><div class="hl">${esc(d.story.headline)}</div><p>${esc(d.story.body)}</p></div>` : ""}
      <h2 class="sub">${t("keyStats")}</h2>${kv2(kv)}
      ${d.competitors && d.competitors.length ? `<p class="muted small">${t("competitors")}: ${d.competitors.map((x) => (x.us ? `<a href="#/s/${esc(x.symbol)}">${esc(x.symbol)}</a>` : esc(x.symbol)) + (x.name ? ` ${esc(x.name)}` : "")).join("、")}</p>` : ""}
      ${d.headlines ? `<div class="teaser-locked"><h2 class="sub">${K.inside}</h2><ul>${[["longTerm", d.headlines.longTerm], ["recent", d.headlines.recent], ["bull", d.headlines.bull], ["bear", d.headlines.bear]].map(([k, h]) => `<li><b>${t(k)}</b>${h ? `: <span class="blur">${esc(h)}</span>` : ""} 🔒</li>`).join("")}<li>${K.more}</li></ul></div>` : ""}
      <div class="teaser-lock"><p>${K.locked}</p><a class="btn primary big" href="#/signup">${K.cta}</a> <a class="btn" href="#/login">${t("login")}</a></div>
      <p class="note">${d.nextEarnings ? `${t("nextEarnings")}: ${fmtDate(d.nextEarnings)} · ` : ""}${t("updated", { date: fmtDate(d.generatedAt || d.asOf) })}</p></article>
      <div class="footer">${t("aiNote")}<br>${t("disclaimer")}<br><a href="#/about">${t("about.link")}</a> · <a href="#/contact">${t("contact.link")}</a></div>`;
  }
  const kv2 = (rows) => `<dl class="kv2">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  async function renderSectors() {
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
    const X = t("sectors");
    document.title = `${X.title} | ${t("siteName")}`;
    app.innerHTML = `<div class="panel spinner">…</div>`;
    let r; try { r = await api("/api/sectors"); } catch (e) { app.innerHTML = `<div class="panel"><div class="error">${t("loadError")}</div></div>`; return; }
    const name = (o) => o[state.locale] || o.en;
    const card = (sx) => `<a class="sector-card" href="#/sector/${esc(sx.id)}"><div class="sc-name">${esc(name(sx.name))}</div>${sx.desc ? `<div class="sc-desc muted">${esc(name(sx.desc))}</div>` : ""}<div class="sc-members muted small">${sx.members.length} ${X.names}: ${sx.members.slice(0, 12).map(esc).join(" ")}${sx.members.length > 12 ? " …" : ""}</div></a>`;
    const ai = r.sectors.filter((x) => x.group === "ai"), gics = r.sectors.filter((x) => x.group === "gics");
    app.innerHTML = `<section class="land sectors"><h2>${esc(X.title)}</h2><p class="lead">${esc(X.lead)}</p>
      <h3 class="sub">${esc(X.aiGroup)}</h3><div class="sector-grid">${ai.map(card).join("")}</div>
      <h3 class="sub">${esc(X.gicsGroup)}</h3><div class="sector-grid">${gics.map(card).join("")}</div>
      <p class="note">${esc(X.note)}</p></section>
      <div class="footer">${t("disclaimer")}<br><a href="#/about">${t("about.link")}</a> · <a href="#/contact">${t("contact.link")}</a></div>`;
  }
  async function renderSector(id) {
    track("sector_report", id);
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
    const X = t("sectors"); const D = t("deep");
    app.innerHTML = `<div class="panel spinner">…</div>`;
    let r; try { r = await api(`/api/sector/${encodeURIComponent(id)}?lang=${encodeURIComponent(state.locale)}`); } catch (e) { app.innerHTML = `<div class="panel"><div class="error">${t(e.status === 404 ? "notFound" : "loadError")}</div></div>`; return; }
    if (state.route.view !== "sector" || state.route.id !== id) return;
    const name = (o) => o[state.locale] || o.en; const sx = r.sector;
    document.title = `${name(sx.name)} | ${t("siteName")}`;
    const rows = r.constituents.filter((c) => !c.error).sort((a, b) => (b.marketCapM || 0) - (a.marketCapM || 0));
    const table = wrap(`<table class="tbl cons"><thead><tr><th>${X.symbol}</th><th>${X.company}</th><th class="num">${t("marketCap")}</th><th class="num">${t("val.peFwd")}</th><th class="num">${X.opMargin}</th><th class="num">${X.revGrowth}</th><th class="num">${t("val.roic")}</th>${sx.layers ? `<th>${X.layers}</th>` : ""}</tr></thead><tbody>${rows.map((c) => `<tr><th><a href="#/s/${esc(c.symbol)}">${esc(c.symbol)}</a></th><td>${esc(c.name)}${c.country && c.country !== "US" ? ` <span class="muted">(${esc(c.country)})</span>` : ""}${c.feature ? `<div class="muted small">${esc(c.feature)}</div>` : ""}</td><td class="num">${fmtBig(c.marketCapM)}</td><td class="num">${fmtDec(c.peForward, 1)}</td><td class="num">${fmtPct(c.opMarginPct)}</td><td class="num">${c.revenueGrowthPct == null ? NA : (c.revenueGrowthPct >= 0 ? "+" : "") + fmtDec(c.revenueGrowthPct, 1) + "%"}</td><td class="num">${fmtPct(c.roicPct)}</td>${sx.layers ? `<td>${(c.layers || []).map((l) => `<span class="tag">${l}</span>`).join(" ")}</td>` : ""}</tr>`).join("")}</tbody></table>`);
    const layers = sx.layers ? `<p class="muted small" style="margin:0 8px 8px">${sx.layers.map((l) => `<b>${l.layer}</b> ${esc(name(l.name))}`).join("　")}</p>` : "";
    const A = r.analysis || {};
    let analysis;
    const names = { quality: X.fq, trajectory: X.ft, valuation: X.fv };
    if (A.status === "ready") analysis = researchHtml(A.summary, D, { findingNames: names, storyTitle: X.storyTitle, battlefieldsTitle: sx.layers ? X.layersTable : X.chainTable, updated: esc(t("updated", { date: fmtDate(A.summary.generatedAt) })) });
    else if (A.status === "locked") analysis = `<section class="card"><div class="teaser-lock"><p>${esc(X.locked)}</p><a class="btn primary big" href="#/signup">${t("teaser").cta}</a> <a class="btn" href="#/login">${t("login")}</a></div></section>`;
    else if (A.status === "pending" || A.status === null || A.status === undefined) { analysis = `<section class="card"><p style="margin:8px"><span class="spinner">${esc(X.generating)}</span></p></section>`; setTimeout(() => { if (state.route.view === "sector" && state.route.id === id) renderSector(id); }, 8000); }
    else if (A.status === "disabled") analysis = `<section class="card"><p class="muted" style="margin:8px">${t("summaryDisabled")}</p></section>`;
    else analysis = `<section class="card"><p class="muted" style="margin:8px">${t("summaryError")}${A.message ? ` <span class="small">(${esc(A.message)})</span>` : ""}</p></section>`;
    app.innerHTML = `<div class="panel"><div class="title-row"><h1>${esc(name(sx.name))}</h1><a class="btn small" href="#/sectors">← ${esc(X.title)}</a></div>${sx.desc ? `<p class="muted">${esc(name(sx.desc))}</p>` : ""}${layers}</div>
      ${sec(X.reportTitle, `<p class="muted deep-intro">${esc(X.reportIntro)}</p>`)}
      ${analysis}
      ${sec(X.constituents, table + `<p class="note">${esc(X.tableNote)}</p>`)}
      <div class="footer">${t("aiNote")}<br>${t("disclaimer")}<br><a href="#/about">${t("about.link")}</a> · <a href="#/contact">${t("contact.link")}</a></div>`;
  }
  function renderAbout() {
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
    const A = t("about"); const B = JSON.parse(JSON.stringify(t("landing.bio")).split("{brand}").join(brandName()));
    document.title = `${A.title} | ${t("siteName")}`;
    app.innerHTML = `<section class="land bio about-page"><h2>${esc(A.title)}</h2>
      <div class="bio-row"><img class="bio-photo" src="/img/paul-tsai.jpg" alt="${esc(B.name)}" width="240" height="320">
        <div class="bio-text"><h3>${esc(B.name)} <span class="muted">${esc(B.role)}</span></h3>
        ${B.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}
        <h4 class="sub">${esc(A.siteTitle.split("{brand}").join(brandName()))}</h4>${A.site.map((p) => `<p>${esc(p.split("{brand}").join(brandName()))}</p>`).join("")}
        <p class="muted small">${esc(B.book)}</p>
        <p><a class="btn" href="https://paultsai.net" target="_blank" rel="noopener">${esc(A.more)}</a> <a class="btn" href="#/contact">${t("contact.link")}</a></p></div></div></section>
      <div class="footer">${t("disclaimer")}<br><a href="#/about">${t("about.link")}</a> · <a href="#/contact">${t("contact.link")}</a></div>`;
  }
  function renderContact() {
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
    const C = t("contact"); const u = state.user;
    app.innerHTML = `<div class="panel form"><h2>${C.title}</h2><p class="muted">${C.lead}</p><div id="formError"></div>
      <form id="authForm">
        <label>${C.name}<input name="name" required maxlength="100" value="${esc(u ? u.username : "")}" autocomplete="name"></label>
        <label>${t("email")}<input name="email" type="email" required value="${esc(u && !u.builtin ? u.email : "")}" autocomplete="email"></label>
        <label>${C.message}<textarea name="message" required minlength="10" maxlength="4000" rows="7"></textarea></label>
        <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
        <button class="btn primary" type="submit">${C.send}</button>
      </form></div>`;
    $("#authForm").addEventListener("submit", async (ev) => {
      ev.preventDefault(); const f = ev.target; const btn = f.querySelector("button"); btn.disabled = true;
      try { await api("/api/contact", { method: "POST", body: { name: f.name.value, email: f.email.value, message: f.message.value, website: f.website.value } }); f.outerHTML = `<p>${esc(C.sent)}</p>`; }
      catch (e) { $("#formError").innerHTML = `<div class="error">${esc(t(`errors.${e.code}`) !== `errors.${e.code}` ? t(`errors.${e.code}`) : e.message)}</div>`; btn.disabled = false; }
    });
  }
  function renderForgot() {
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
    const P = t("pw");
    app.innerHTML = `<div class="panel form"><h2>${P.forgotTitle}</h2><p class="muted">${P.forgotLead}</p><div id="formError"></div>
      <form id="authForm"><label>${t("email")}<input name="email" type="email" required autocomplete="email"></label><button class="btn primary" type="submit">${P.sendLink}</button></form>
      <div class="alt"><a href="#/login">${t("login")}</a></div></div>`;
    $("#authForm").addEventListener("submit", async (ev) => {
      ev.preventDefault(); const btn = ev.target.querySelector("button"); btn.disabled = true;
      try { const r = await api("/api/auth/forgot", { method: "POST", body: { email: ev.target.email.value } }); $("#authForm").outerHTML = `<p>${esc(r.mail ? P.sent : P.sentNoMail)}</p>`; }
      catch (e) { $("#formError").innerHTML = `<div class="error">${esc(e.message)}</div>`; btn.disabled = false; }
    });
  }
  function renderReset(token) {
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
    const P = t("pw");
    app.innerHTML = `<div class="panel form"><h2>${P.resetTitle}</h2><div id="formError"></div>
      <form id="authForm"><label>${P.newPassword}<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <label>${P.confirm}<input name="confirm" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="btn primary" type="submit">${P.setPassword}</button></form></div>`;
    $("#authForm").addEventListener("submit", async (ev) => {
      ev.preventDefault(); const f = ev.target; const btn = f.querySelector("button");
      if (f.password.value !== f.confirm.value) { $("#formError").innerHTML = `<div class="error">${P.mismatch}</div>`; return; }
      btn.disabled = true;
      try { const r = await api("/api/auth/reset", { method: "POST", body: { token, password: f.password.value } }); state.user = r.user; state.ent = r.entitlement; renderUserMenu(); location.hash = "#/s/AAPL"; }
      catch (e) { $("#formError").innerHTML = `<div class="error">${esc(t(`errors.${e.code}`) !== `errors.${e.code}` ? t(`errors.${e.code}`) : e.message)}</div>`; btn.disabled = false; }
    });
  }
  function renderAccount() {
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
    const u = state.user; const e = state.ent; const B = t("billing");
    const canSubscribe = state.config.billingEnabled && !["subscribed", "admin", "complimentary"].includes(e && e.state);
    const hasSub = u.subscription && u.subscription.id;
    const canCancel = hasSub && ["active", "on_trial", "past_due"].includes(u.subscription.status);
    app.innerHTML = `<div class="panel form"><h2>${t("account")}</h2>
      <div class="kv"><div>${t("username")}</div><div>${esc(u.username)}</div><div>${t("email")}</div><div>${esc(u.email)}</div><div>${t("pricing")}</div><div>${statusLine()}</div></div>
      <div id="formError">${location.hash.includes("checkout=success") && !hasSub ? `<div class="pill">${esc(B.checkoutDone)}</div>` : ""}</div>
      ${canSubscribe ? subscribeButtons() : ""}
      ${u.builtin ? "" : `<h3 class="billing-h">${t("pw.changeTitle")}</h3><form id="pwForm"><label>${t("pw.current")}<input name="currentPassword" type="password" required autocomplete="current-password"></label><label>${t("pw.newPassword")}<input name="newPassword" type="password" required minlength="8" autocomplete="new-password"></label><label>${t("pw.confirm")}<input name="confirm" type="password" required minlength="8" autocomplete="new-password"></label><button class="btn" type="submit">${t("pw.change")}</button> <span id="pwMsg" class="muted small"></span></form>`}
      <h3 class="billing-h">${B.title}</h3>
      ${hasSub ? `<button class="btn" id="portalBtn">${t("manageBilling")}</button><p class="muted small">${B.portalHint}</p>` : ""}
      ${canCancel ? `<button class="btn" id="cancelBtn">${B.cancelSub}</button><div id="cancelBox" hidden><p>${B.cancelConfirm}</p><button class="btn danger" id="cancelYes">${B.cancelSub}</button> <button class="btn" id="cancelNo">${B.back}</button></div>` : ""}
      ${u.builtin ? "" : `<button class="btn danger-outline" id="deleteBtn">${B.deleteAcct}</button><div id="deleteBox" hidden><p>${B.deleteConfirm}</p><input type="password" id="deletePw" autocomplete="current-password" placeholder="${t("password")}"><div style="margin-top:8px"><button class="btn danger" id="deleteYes">${B.deleteBtn}</button> <button class="btn" id="deleteNo">${B.back}</button></div></div>`}
      <p class="muted" style="margin-top:14px">${t("priceLine", { price: state.config.priceLabel })}</p></div>`;
    bindBilling();
    pollAfterCheckout();
    const pf = $("#pwForm"); if (pf) pf.addEventListener("submit", async (ev) => {
      ev.preventDefault(); const P = t("pw"); const msg = $("#pwMsg");
      if (pf.newPassword.value !== pf.confirm.value) { msg.textContent = P.mismatch; return; }
      const btn = pf.querySelector("button"); btn.disabled = true; msg.textContent = "";
      try { await api("/api/auth/change-password", { method: "POST", body: { currentPassword: pf.currentPassword.value, newPassword: pf.newPassword.value } }); pf.reset(); msg.textContent = P.changed; }
      catch (e2) { msg.textContent = t(`errors.${e2.code}`) !== `errors.${e2.code}` ? t(`errors.${e2.code}`) : e2.message; }
      btn.disabled = false;
    });
    const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };
    const err = (e2) => { $("#formError").innerHTML = `<div class="error">${esc(t(`errors.${e2.code}`) !== `errors.${e2.code}` ? t(`errors.${e2.code}`) : e2.message)}</div>`; };
    const cb = $("#cancelBtn"); if (cb) cb.addEventListener("click", () => show("#cancelBox", true));
    const cn = $("#cancelNo"); if (cn) cn.addEventListener("click", () => show("#cancelBox", false));
    const cy = $("#cancelYes"); if (cy) cy.addEventListener("click", async () => {
      cy.disabled = true;
      try { const r = await api("/api/auth/cancel-subscription", { method: "POST" }); state.user = r.user; state.ent = r.entitlement; renderUserMenu(); renderAccount(); $("#formError").innerHTML = `<div class="pill">${esc(B.cancelDone.replace("{date}", fmtDate(r.user.subscription.endsAt)))}</div>`; }
      catch (e2) { if (e2.code === "billing_not_configured") { try { const r = await api("/api/billing/portal"); window.location.href = r.url; } catch (e3) { err(e3); } } else err(e2); cy.disabled = false; }
    });
    const db = $("#deleteBtn"); if (db) db.addEventListener("click", () => show("#deleteBox", true));
    const dn = $("#deleteNo"); if (dn) dn.addEventListener("click", () => show("#deleteBox", false));
    const dy = $("#deleteYes"); if (dy) dy.addEventListener("click", async () => {
      dy.disabled = true;
      try { await api("/api/auth/delete-account", { method: "POST", body: { password: $("#deletePw").value } }); state.user = null; state.ent = null; renderUserMenu(); location.hash = "#/"; state.route = parseRoute(); render(); }
      catch (e2) { err(e2); dy.disabled = false; }
    });
  }

  // ---------- admin panel ----------
  async function renderAdmin() {
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
    app.innerHTML = `<div class="panel spinner">…</div>`;
    let d;
    try { d = await api("/api/admin/stats"); } catch (e) { app.innerHTML = `<div class="panel"><div class="error">${esc(e.message)}</div></div>`; return; }
    const T = d.totals;
    const tile = (l, v, sub = "") => `<div class="stat"><div class="stat-l">${l}</div><div class="stat-v">${v}</div>${sub ? `<div class="stat-s">${sub}</div>` : ""}</div>`;
    const bars = activityBars(d.series);;
    const states = Object.entries(T.states).map(([k, v]) => `${k} ${v}`).join(" · ");
    const w = d.warm.last;
    app.innerHTML = `<div class="admin">
      <h2>${t("billing.adminPanel")} <span class="muted small">${esc(fmtDate(d.generatedAt))}</span> <button class="btn small" id="warmBtn">Run warmer now</button> <button class="btn small" id="warmAllBtn">Generate everything missing now</button></h2>
      <div class="stats stats-admin">${tile("Users", fmtInt(T.users), esc(states))}${tile("Signups 7d / 30d", `${T.signups7d} / ${T.signups30d}`)}${tile("Active today / 7d / 30d", `${T.activeToday} / ${T.active7d} / ${T.active30d}`)}${tile("Page views 30d", fmtInt(T.views30d), `demo ${fmtInt(T.demo30d)}`)}${tile("AI runs 30d", `${T.aiGenerations30d} gen / ${T.aiTranslations30d} tr`, `≈ US$${fmtDec(T.aiCostUsd30d, 2)}`)}${tile("Warmer", w ? (w.running ? "running" : "idle") : "never ran", w ? `${esc((w.finishedAt || w.startedAt).slice(0, 16).replace("T", " "))} · gen ${w.generated.length} · tr ${w.translated.length} · err ${w.errors.length}` : `${d.warm.universe} tickers, ${d.warm.perRun}/run`)}</div>
      <section class="card"><h3 class="sec">AI digest &amp; deep-dive coverage (S&amp;P 500 + AI names)<span class="sec-extra">${w && w.running ? `running (${w.shards || 1} shards) · now ${esc(d.warm.current || "")}` : "idle"} · hourly at :17 · ${d.warm.settings ? `${d.warm.settings.shards} shards × ${d.warm.perRun} new` : `${d.warm.perRun} new`} per run · new transcripts regenerate automatically</span></h3>
        <div class="stats stats-admin">${tile("Universe", fmtInt(d.warm.universe), "tickers")}${tile("Complete", `${fmtInt(d.warm.done)} / ${fmtInt(d.warm.universe)}`, `${Math.round((d.warm.done / Math.max(1, d.warm.universe)) * 100)}% have every language`)}${tile("Queued", fmtInt(d.warm.pending.length), `${fmtInt(d.warm.untouched)} not started`)}${tile("Generated today", fmtInt(d.warm.generatedToday), `≈ $${d.warm.costToday.toFixed(2)} incl. translations`)}${w ? tile("Last run", w.finishedAt ? esc(fmtDate(w.finishedAt)) : "running", `${(w.generated || []).length} generated · ${(w.translated || []).length} translated · ${(w.errors || []).length} errors`) : ""}</div>
        ${d.warm.langs.map((l) => { const n = d.warm.coverage[l] || 0; const p = Math.round((n / d.warm.universe) * 100); return `<div class="cov"><span class="cov-l">${esc(l)}</span><div class="cov-bar"><div class="cov-fill" style="width:${p}%"></div></div><span class="cov-n">${fmtInt(n)} / ${fmtInt(d.warm.universe)}</span></div>`; }).join("")}
        <p class="note">${d.warm.pending.length ? `Queued (${d.warm.pending.length}): ${d.warm.pending.slice(0, 80).map((x) => esc(x)).join(", ")}${d.warm.pending.length > 80 ? ", …" : ""}` : "All tickers have every language."}</p>
      </section>
      <section class="card"><h3 class="sec">Daily activity <span class="ranges" data-actranges>${[[30, "30d"], [60, "60d"], [90, "90d"], [180, "6m"], [365, "1y"]].map(([n, l]) => `<button data-range="${n}" class="${n === 30 ? "active" : ""}">${l}</button>`).join("")}</span><span class="sec-extra">views + demo (light) · weekly bars beyond 90 days · JST days</span></h3><div class="bars" id="activityBars">${bars}</div><p class="note" id="activityNote"></p></section>
      <section class="card"><h3 class="sec">Where visitors are from (30 days)<span class="sec-extra">by Netlify geolocation of each request · members and anonymous visitors</span></h3>
        <div class="grid2b">${wrap(`<table class="tbl"><thead><tr><th>Country</th><th>Events</th><th>Page views</th><th>Visitors</th><th>Members</th></tr></thead><tbody>${(d.geo.countries || []).map((c) => `<tr><td>${esc(countryName(c.code))}</td><td class="num">${fmtInt(c.events)}</td><td class="num">${fmtInt(c.views)}</td><td class="num">${fmtInt(c.visitors)}</td><td class="num">${fmtInt(c.members)}</td></tr>`).join("") || "<tr><td>—</td></tr>"}</tbody></table>`)}
        ${wrap(`<table class="tbl"><thead><tr><th>City</th><th>Events</th><th>People</th></tr></thead><tbody>${(d.geo.places || []).map((p) => `<tr><td>${esc([p.city, p.region, countryName(p.country)].filter(Boolean).join(", "))}</td><td class="num">${fmtInt(p.events)}</td><td class="num">${fmtInt(p.people)}</td></tr>`).join("") || "<tr><td>—</td></tr>"}</tbody></table>`)}</div>
      </section>
      <div class="grid2b">
        <section class="card"><h3 class="sec">Top tickers (30 days)</h3>${wrap(`<table class="tbl"><tbody>${d.topSymbols.map((x) => `<tr><th><a href="#/s/${esc(x.symbol)}">${esc(x.symbol)}</a></th><td class="num">${x.views}</td></tr>`).join("") || "<tr><td>—</td></tr>"}</tbody></table>`)}</section>
        ${d.contact && d.contact.length ? `<section class="card"><h3 class="sec">Contact messages</h3>${wrap(`<table class="tbl"><tbody>${d.contact.map((m) => `<tr><th>${esc(m.createdAt.slice(0, 16).replace("T", " "))}</th><td>${esc(m.name)}<br><a href="mailto:${esc(m.email)}">${esc(m.email)}</a>${m.username ? `<br><span class="muted">user ${esc(m.username)}</span>` : ""}</td><td style="white-space:pre-wrap">${esc(m.message)}</td><td class="muted">${m.sent ? "emailed" : "stored"}</td></tr>`).join("")}</tbody></table>`)}</section>` : ""}
        ${d.mail && d.mail.pendingResets.length ? `<section class="card"><h3 class="sec">Password reset links${d.mail.configured ? "" : " (email not configured: send these by hand)"}</h3>${wrap(`<table class="tbl"><tbody>${d.mail.pendingResets.map((r) => `<tr><th>${esc(r.username)}</th><td>${esc(r.email)}</td><td><a href="${esc(r.link)}">${esc(r.link)}</a></td><td class="muted">${esc(new Date(r.expiresAt).toISOString().slice(11, 16))} UTC</td></tr>`).join("")}</tbody></table>`)}</section>` : ""}
        <section class="card"><h3 class="sec">Recent activity<span class="sec-extra">JST</span></h3>${wrap(`<table class="tbl"><tbody>${d.recent.map((e) => `<tr><th>${esc(fmtJst(e.ts))}</th><td>${whoLink(e.user)}</td><td>${esc(e.action)}</td><td>${esc(e.detail)}</td><td class="muted">${esc(placeOf(e))}</td></tr>`).join("")}</tbody></table>`)}</section>
      </div>
      <section class="card"><h3 class="sec">Access log<span class="sec-extra">every recorded request · JST</span></h3>
        <form id="logForm" class="coupon-admin"><select name="days"><option value="1">today</option><option value="7" selected>7 days</option><option value="30">30 days</option></select> <input name="user" placeholder="user or visitor id" style="width:12em"> <input name="action" placeholder="action (view, tab, search…)" style="width:14em"> <input name="country" placeholder="CC" maxlength="2" style="width:4em;text-transform:uppercase"> <button class="btn small" type="submit">Load</button> <span id="logMsg" class="muted small"></span></form>
        <div id="logTable"></div>
      </section>
      <section class="card"><h3 class="sec">Users <a class="btn small" href="/api/admin/users.xlsx" download>Export to Excel</a><span class="sec-extra">click a name for everything that member did</span></h3>${wrap(`<table class="tbl"><thead><tr><th>User</th><th>Email</th><th>Signed up</th><th>Status</th><th>Lang</th><th>Events 30d</th><th>Last seen (JST)</th><th>Location</th></tr></thead><tbody>${d.users.map((u) => `<tr><td><a href="#/admin/user/${esc(encodeURIComponent(u.username))}">${esc(u.username)}</a>${u.role ? ` <span class="pill">${esc(u.role)}</span>` : ""}</td><td>${esc(u.email)}</td><td>${esc(fmtDate(new Date(u.createdAt).toISOString()))}</td><td>${esc(u.state)}${u.status ? ` (${esc(u.status)})` : ""}</td><td>${esc(u.locale || "")}</td><td class="num">${fmtInt(u.events30d || 0)}</td><td>${u.lastSeen ? esc(fmtJst(u.lastSeen)) : "—"}</td><td class="muted">${u.location ? esc(placeOf(u.location)) : ""}</td></tr>`).join("")}</tbody></table>`)}</section>
      <section class="card"><h3 class="sec">Complimentary member<span class="sec-extra">family, friends, press: full access, never billed</span></h3>
        <form id="memberForm" class="coupon-admin"><input name="username" placeholder="username" required minlength="3" maxlength="32"> <input name="email" type="email" placeholder="email (optional)"> <input name="password" type="password" placeholder="password (8+)" required minlength="8" autocomplete="new-password"> <input name="note" placeholder="note" maxlength="120"> <button class="btn small" type="submit">Create</button> <span id="memberMsg" class="muted small"></span></form>
      </section>
      <section class="card"><h3 class="sec">Access codes (free months, no card)</h3>
        <form id="couponForm" class="coupon-admin"><input name="code" placeholder="CODE" required maxlength="40" style="text-transform:uppercase"> <input name="months" type="number" min="1" max="60" value="6" style="width:5em" title="months"> <input name="max" type="number" min="0" value="0" style="width:5em" title="max uses (0 = unlimited)"> <input name="expires" type="date" title="expires"> <input name="note" placeholder="note" maxlength="120"> <button class="btn small" type="submit">Create / update</button> <span id="couponMsg" class="muted small"></span></form>
        <div id="couponList">${wrap(`<table class="tbl"><thead><tr><th>Code</th><th>Months</th><th>Uses</th><th>Expires</th><th>Note</th><th></th></tr></thead><tbody>${(d.coupons || []).map((c) => `<tr><td><code>${esc(c.code)}</code>${c.active ? "" : " <span class=\"pill\">off</span>"}</td><td class="num">${c.months}</td><td class="num">${c.uses}${c.maxUses ? ` / ${c.maxUses}` : ""}</td><td>${c.expiresAt ? esc(new Date(c.expiresAt).toISOString().slice(0, 10)) : "—"}</td><td>${esc(c.note || "")}</td><td>${c.active ? `<button class="btn small" data-off="${esc(c.code)}">Deactivate</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">None yet. A code gives its months of free access, no card; a link such as ${esc(location.origin)}/?coupon=CODE pre-fills it.</td></tr>`}</tbody></table>`)}</div>
      </section>
      ${w && w.errors.length ? `<section class="card"><h3 class="sec">Warmer errors</h3><ul>${w.errors.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>` : ""}
    </div>`;
    $("#memberForm").addEventListener("submit", async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try { const r = await api("/api/admin/member", { method: "POST", body: { username: f.username.value.trim(), email: f.email.value.trim(), password: f.password.value, note: f.note.value } }); $("#memberMsg").textContent = `Created ${r.user.username} (${r.user.entitlement.state})`; f.reset(); }
      catch (e) { $("#memberMsg").textContent = t(`errors.${e.code}`) !== `errors.${e.code}` ? t(`errors.${e.code}`) : e.message; }
    });
    $("#couponForm").addEventListener("submit", async (ev) => {
      ev.preventDefault(); const f = ev.target; const q = new URLSearchParams({ code: f.code.value, months: f.months.value, max: f.max.value || "0", expires: f.expires.value || "", note: f.note.value || "" });
      try { await api(`/api/admin/coupon?${q}`, { method: "POST" }); renderAdmin(); } catch (e) { $("#couponMsg").textContent = e.message; }
    });
    document.querySelectorAll("#couponList [data-off]").forEach((b) => b.addEventListener("click", async () => { try { await api(`/api/admin/coupon?deactivate=1&code=${encodeURIComponent(b.dataset.off)}`, { method: "POST" }); renderAdmin(); } catch (e) { $("#couponMsg").textContent = e.message; } }));
    // activity chart ranges (rolled up server-side; long ranges may need a second request)
    document.querySelectorAll("[data-actranges] button").forEach((btn) => btn.addEventListener("click", async () => {
      document.querySelectorAll("[data-actranges] button").forEach((x) => x.classList.toggle("active", x === btn));
      const n = Number(btn.dataset.range); $("#activityNote").textContent = "loading…";
      try { let r, tries = 0; do { r = await api(`/api/admin/series?days=${n}`); tries++; } while (r.incomplete && tries < 12); $("#activityBars").innerHTML = activityBars(r.series.filter((x) => !x.pending)); $("#activityNote").textContent = r.incomplete ? "Some older days are still being rolled up; click again." : ""; }
      catch (e) { $("#activityNote").textContent = e.message; }
    }));
    // access log
    const loadLog = async () => {
      const f = $("#logForm"); const q = new URLSearchParams({ days: f.days.value, user: f.user.value.trim(), action: f.action.value.trim(), country: f.country.value.trim(), limit: "300" });
      $("#logMsg").textContent = "loading…";
      try { const r = await api(`/api/admin/events?${q}`); $("#logMsg").textContent = `${fmtInt(r.total)} events in ${r.days} day(s)${r.total > r.events.length ? `, showing ${r.events.length}` : ""}`; $("#logTable").innerHTML = wrap(`<table class="tbl"><thead><tr><th>Time (JST)</th><th>Who</th><th>Action</th><th>Detail</th><th>Location</th></tr></thead><tbody>${r.events.map((e) => `<tr><th>${esc(fmtJst(e.ts))}</th><td>${whoLink(e.user)}</td><td>${esc(e.action)}</td><td>${esc(e.detail)}</td><td class="muted">${esc(placeOf(e))}</td></tr>`).join("") || "<tr><td>—</td></tr>"}</tbody></table>`); }
      catch (e) { $("#logMsg").textContent = e.message; }
    };
    $("#logForm").addEventListener("submit", (ev) => { ev.preventDefault(); loadLog(); }); loadLog();
    const warmClick = (id, url, label) => $(id).addEventListener("click", async () => { $(id).disabled = true; try { const r = await api(url, { method: "POST" }); $(id).textContent = `${label} (${r.shards} shards)`; } catch (e) { $(id).textContent = e.message; } });
    warmClick("#warmBtn", "/api/admin/warm", "Warmer started"); warmClick("#warmAllBtn", "/api/admin/warm?full=1", "Full run started");
  }

  // ---------- admin helpers ----------
  const fmtJst = (ts) => { try { return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts)); } catch { return new Date(ts).toISOString().slice(0, 16).replace("T", " "); } };
  const countryName = (code) => { if (!code || code === "ZZ") return "unknown"; try { return `${new Intl.DisplayNames(["en"], { type: "region" }).of(code)} (${code})`; } catch { return code; } };
  const placeOf = (e) => [e.city, e.region, e.country && e.country !== "ZZ" ? e.country : null].filter(Boolean).join(", ") || (e.country === "ZZ" ? "unknown" : "");
  const whoLink = (u) => !u || u === "anon" || u === "system" ? esc(u || "") : `<a href="#/admin/user/${esc(encodeURIComponent(u))}">${esc(u)}</a>${u.startsWith("v_") ? ' <span class="muted small">visitor</span>' : ""}`;
  function activityBars(series) {
    let rows = series;
    if (rows.length > 90) { // weekly buckets for long ranges
      const weeks = []; for (let i = 0; i < rows.length; i += 7) { const w = rows.slice(i, i + 7); weeks.push({ day: `${w[0].day} – ${w[w.length - 1].day.slice(5)}`, views: w.reduce((a, x) => a + (x.views || 0), 0), demo: w.reduce((a, x) => a + (x.demo || 0), 0), logins: w.reduce((a, x) => a + (x.logins || 0), 0), signups: w.reduce((a, x) => a + (x.signups || 0), 0), ai: w.reduce((a, x) => a + (x.ai || 0), 0), activeUsers: Math.max(...w.map((x) => x.activeUsers || 0)) }); } rows = weeks;
    }
    const maxV = Math.max(1, ...rows.map((x) => (x.views || 0) + (x.demo || 0)));
    const every = rows.length > 40 ? Math.ceil(rows.length / 20) : 1;
    return rows.map((x, i) => `<div class="bar" title="${esc(x.day)}: views ${x.views || 0}, demo ${x.demo || 0}, logins ${x.logins || 0}, signups ${x.signups || 0}, AI ${x.ai || 0}, active members ${x.activeUsers || 0}"><div class="bar-fill" style="height:${Math.round((((x.views || 0) + (x.demo || 0)) / maxV) * 100)}%"></div><div class="bar-fill demo" style="height:${Math.round(((x.demo || 0) / maxV) * 100)}%"></div>${i % every === 0 ? `<span class="bar-l">${esc(String(x.day).slice(5, 10))}</span>` : ""}</div>`).join("");
  }
  async function renderAdminUser(username) {
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
    app.innerHTML = `<div class="panel spinner">…</div>`;
    let d; try { d = await api(`/api/admin/user?username=${encodeURIComponent(username)}`); } catch (e) { app.innerHTML = `<div class="panel"><div class="error">${esc(e.message)}</div></div>`; return; }
    const u = d.user; const tile = (l, v, sub = "") => `<div class="stat"><div class="stat-l">${l}</div><div class="stat-v">${v}</div>${sub ? `<div class="stat-s">${sub}</div>` : ""}</div>`;
    const list = (title, rows, fmt = (r) => esc(r.key)) => `<section class="card"><h3 class="sec">${title}</h3>${rows.length ? wrap(`<table class="tbl"><tbody>${rows.map((r) => `<tr><th>${fmt(r)}</th><td class="num">${fmtInt(r.n)}</td></tr>`).join("")}</tbody></table>`) : "<p class='muted'>—</p>"}</section>`;
    app.innerHTML = `<div class="admin">
      <h2><a class="btn small" href="#/admin">← ${t("billing.adminPanel")}</a> ${esc(u.username)}${u.anonymous ? ' <span class="pill">anonymous visitor</span>' : u.role ? ` <span class="pill">${esc(u.role)}</span>` : ""}</h2>
      ${u.anonymous ? "" : `<div class="kv"><div>Email</div><div>${esc(u.email)}</div><div>Signed up</div><div>${esc(fmtJst(u.createdAt))}</div><div>Status</div><div>${esc(u.entitlement.state)}${u.subscription ? ` · ${esc(u.subscription.status)}${u.subscription.cardBrand ? ` · ${esc(u.subscription.cardBrand)} ${esc(u.subscription.cardLastFour || "")}` : ""}${u.subscription.renewsAt ? ` · renews ${esc(fmtDate(u.subscription.renewsAt))}` : ""}` : u.trialEndsAt ? ` · free until ${esc(fmtDate(new Date(u.trialEndsAt).toISOString()))}` : ""}</div><div>Language</div><div>${esc(u.locale || "")}</div>${u.coupons && u.coupons.length ? `<div>Codes</div><div>${u.coupons.map((c) => `${esc(c.code)} (${c.months}m, ${esc(fmtJst(c.at))})`).join(", ")}</div>` : ""}</div>`}
      <div class="stats stats-admin">${tile("Events (90d)", fmtInt(d.total))}${tile("Days active", fmtInt(d.daysActive))}${tile("First seen", d.firstSeen ? esc(fmtJst(d.firstSeen)) : "—")}${tile("Last seen", d.lastSeen ? esc(fmtJst(d.lastSeen)) : "—")}${tile("Devices", d.devices.map((x) => `${esc(x.key)} ${x.n}`).join(" · ") || "—")}</div>
      <div class="grid2b">${list("Locations", d.locations)}${list("Tickers viewed", d.tickers, (r) => `<a href="#/s/${esc(r.key)}">${esc(r.key)}</a>`)}${list("Tabs opened", d.tabs)}${list("Actions", d.actions)}${list("Sectors", d.sectors)}${list("Searches", d.searches)}</div>
      <section class="card"><h3 class="sec">Timeline<span class="sec-extra">JST · newest first</span></h3>${wrap(`<table class="tbl"><thead><tr><th>Time</th><th>Action</th><th>Detail</th><th>Location</th><th>Device</th></tr></thead><tbody>${d.timeline.map((e) => `<tr><th>${esc(fmtJst(e.ts))}</th><td>${esc(e.action)}</td><td>${esc(e.detail)}</td><td class="muted">${esc(placeOf(e))}</td><td class="muted">${esc(e.device || "")}</td></tr>`).join("") || "<tr><td>—</td></tr>"}</tbody></table>`)}</section>
    </div>`;
  }

  function renderPaywall() {
    stopSummaryPolling(state.stock); stopSummaryPolling(state.demo);
    app.innerHTML = `<div class="panel form"><h2>${t("paywallTitle")}</h2><p>${t("paywallBody", { price: state.config.priceLabel })}</p>
      <div id="formError"></div>
      ${state.config.billingEnabled ? subscribeButtons() : `<p class="error">${t("errors.billing_not_configured")}</p>`}
      ${state.user && state.user.subscription && state.user.subscription.id ? `<button class="btn" id="portalBtn">${t("manageBilling")}</button>` : ""}</div>`;
    bindBilling();
  }

  // After Stripe Checkout returns, the webhook can land a few seconds later: refresh the account until it does.
  function pollAfterCheckout() {
    if (!location.hash.includes("checkout=success")) return;
    let tries = 0;
    const tick = async () => {
      try { const r = await api("/api/auth/me"); if (r.user) { state.user = r.user; state.ent = r.entitlement; } } catch {}
      if (state.user && state.user.subscription && state.user.subscription.id) { location.hash = "#/account"; renderUserMenu(); renderAccount(); return; }
      if (++tries < 15) setTimeout(tick, 2000);
    };
    setTimeout(tick, 1500);
  }
  // One button for the monthly plan, a second for the annual plan when the site offers one.
  // ---------- coupon codes (Stripe promotion codes) ----------
  // A code comes from the box below or from a link like /?coupon=CODE; it is kept on this
  // device until checkout and pre-applied to the Stripe page.
  const coupon = { get: () => { try { return JSON.parse(localStorage.getItem("coupon") || "null"); } catch { return null; } }, set: (c) => { try { if (c) localStorage.setItem("coupon", JSON.stringify(c)); else localStorage.removeItem("coupon"); } catch {} } };
  function couponDesc(c) {
    const what = c.percentOff === 100 ? t("coupon.free") : c.percentOff ? t("coupon.off", { pct: c.percentOff }) : t("coupon.offAmount", { amount: `${c.amountOff}${c.currency ? " " + String(c.currency).toUpperCase() : ""}` });
    const when = c.duration === "repeating" ? t("coupon.forMonths", { months: c.months }) : c.duration === "forever" ? t("coupon.forever") : t("coupon.once");
    return `${what} ${when}`;
  }
  function couponBox() {
    const c = coupon.get();
    if (!state.user) return "";
    if (c && c.pending) {
      // A code from a link has not been checked yet: verify it, then redraw.
      api(`/api/billing/coupon?code=${encodeURIComponent(c.code)}`).then((r) => { coupon.set(r.coupon); render(); }).catch(() => { coupon.set(null); render(); });
      return `<div class="coupon applied"><span>${esc(t("coupon.applied", { desc: c.code }))}</span></div>`;
    }
    if (c && c.kind === "access") return `<div class="coupon applied"><span>${esc(t("coupon.applied", { desc: `${c.code}: ${t("coupon.freeMonths", { months: c.months })}` }))}</span> <button class="btn small primary" id="couponRedeem">${esc(t("coupon.redeem"))}</button> <button class="btn small" id="couponRemove">${esc(t("coupon.remove"))}</button><div id="couponError"></div></div>`;
    if (c) return `<div class="coupon applied"><span>${esc(t("coupon.applied", { desc: `${c.code}: ${couponDesc(c)}` }))}</span> <button class="btn small" id="couponRemove">${esc(t("coupon.remove"))}</button></div>`;
    return `<div class="coupon"><label for="couponInput">${esc(t("coupon.label"))}</label> <input id="couponInput" placeholder="${esc(t("coupon.placeholder"))}" maxlength="40" autocapitalize="characters"> <button class="btn small" id="couponApply">${esc(t("coupon.apply"))}</button><div id="couponError"></div></div>`;
  }
  function subscribeButtons() {
    const a = annualInfo();
    const monthly = `<button class="btn primary" id="subscribeBtn">${t("subscribe")} — ${esc(state.config.priceLabel)} ${esc(t("perMonth"))}</button>`;
    if (!a) return monthly + couponBox();
    return `<div class="plans">${monthly} <button class="btn primary" id="subscribeAnnualBtn">${esc(t("annual.button", { price: a.label, pct: a.pct }))}</button><p class="muted small">${esc(t("annual.note", { perMonth: a.perMonth }))}</p></div>` + couponBox();
  }
  function bindBilling() {
    const err = (e) => `<div class="error">${esc(t(`errors.${e.code}`) !== `errors.${e.code}` ? t(`errors.${e.code}`) : e.message)}</div>`;
    const go = async (action) => {
      const c = coupon.get(); const stripeCode = c && c.kind === "stripe" ? c.code : null;
      try { const r = await api(`/api/billing/${action}${stripeCode ? `&coupon=${encodeURIComponent(stripeCode)}` : ""}`); window.location.href = r.url; }
      catch (e) { if (e.code === "invalid_coupon") coupon.set(null); $("#formError").innerHTML = err(e); if (e.code === "invalid_coupon") render(); }
    };
    const s = $("#subscribeBtn"); if (s) s.addEventListener("click", () => go("checkout?plan=monthly"));
    const sa = $("#subscribeAnnualBtn"); if (sa) sa.addEventListener("click", () => go("checkout?plan=annual"));
    const ca = $("#couponApply");
    if (ca) {
      const apply = async () => {
        const code = ($("#couponInput").value || "").trim().toUpperCase(); if (!code) return;
        try { const r = await api(`/api/billing/coupon?code=${encodeURIComponent(code)}`); coupon.set(r.coupon); render(); }
        catch (e) { $("#couponError").innerHTML = err(e); }
      };
      ca.addEventListener("click", apply);
      $("#couponInput").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); apply(); } });
    }
    const cr = $("#couponRemove"); if (cr) cr.addEventListener("click", () => { coupon.set(null); render(); });
    const rd = $("#couponRedeem");
    if (rd) rd.addEventListener("click", async () => {
      const c = coupon.get(); rd.disabled = true;
      try { const r = await api(`/api/billing/redeem?code=${encodeURIComponent(c.code)}`, { method: "POST" }); coupon.set(null); state.user = r.user; state.ent = r.entitlement; renderUserMenu(); render(); $("#formError").innerHTML = `<div class="pill">${esc(t("coupon.redeemed", { date: fmtDate(new Date(r.until).toISOString()) }))}</div>`; }
      catch (e) { if (e.code === "invalid_coupon" || e.code === "coupon_used") coupon.set(null); $("#couponError").innerHTML = err(e); rd.disabled = false; }
    });
    const p = $("#portalBtn"); if (p) p.addEventListener("click", () => go("portal"));
  }

  // ---------- stock ----------
  // ---------- stock page component (used by the real page and the landing sample) ----------
  function newCtx(demo) { return { demo, b: null, s: null, summaryStatus: null, chartRange: "1y", chartCache: {}, tab: 0, root: null, timer: null, tries: 0 }; }
  state.stock = newCtx(false);
  state.demo = newCtx(true);

  async function loadStock(symbol) {
    stopSummaryPolling(state.stock); stopDeepPolling(state.stock);
    const c = state.stock;
    if (state.symbol !== symbol) { c.b = null; c.chartCache = {}; c.techCache = {}; c.s = null; c.summaryStatus = null; c.d = null; c.deepStatus = null; c.tab = 0; }
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
    app.innerHTML = `<div data-stock></div><div class="footer">${t("aiNote")}<br>${t("disclaimer")}<br><a href="#/about">${t("about.link")}</a> · <a href="#/contact">${t("contact.link")}</a></div>`;
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
    container.querySelectorAll("[data-ranges] button").forEach((btn) => btn.addEventListener("click", () => { c.chartRange = btn.dataset.range; if (!c.demo) track("range", `${state.symbol}_${c.chartRange}`); container.querySelectorAll("[data-ranges] button").forEach((x) => x.classList.toggle("active", x === btn)); loadChart(c); }));
    container.querySelectorAll("[data-tabs] button").forEach((btn) => btn.addEventListener("click", () => { c.tab = Number(btn.dataset.tab); if (!c.demo) track("tab", `${state.symbol}_${TAB_KEYS[c.tab] || c.tab}`); container.querySelectorAll("[data-tabs] button").forEach((x) => x.classList.toggle("active", x === btn)); renderTab(c); if (!c.demo) window.scrollTo({ top: container.querySelector("[data-tabs]").offsetTop - 8, behavior: "smooth" }); }));
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

  window.addEventListener("resize", () => markScrollable());
  function markScrollable(root) {
    (root || document).querySelectorAll(".tw").forEach((el) => el.classList.toggle("scrolls", el.scrollWidth > el.clientWidth + 2));
  }
  function renderTab(c) {
    const body = c.root && c.root.querySelector("[data-tabbody]"); if (!body) return;
    body.innerHTML = [tabOverview, tabFinancials, tabValuation, tabTechnical, tabHolders, tabDeep][c.tab](c);
    if (c.tab === 2) bindTarget(c);
    if (c.tab === 3) { body.querySelectorAll("[data-techranges] button").forEach((btn) => btn.addEventListener("click", () => { c.techRange = btn.dataset.range; if (!c.demo) track("techrange", `${state.symbol}_${c.techRange}`); body.querySelectorAll("[data-techranges] button").forEach((x) => x.classList.toggle("active", x === btn)); loadTechChart(c); })); loadTechChart(c); }
    if (c.tab === 5 && !c.d && c.deepStatus !== "pending" && c.deepStatus !== "disabled") loadDeep(c);
    markScrollable(body);
  }

  // ---- small builders ----
  const sec = (title, inner, extra = "") => `<section class="card"><h3 class="sec"><span class="sec-t">${title}</span>${extra ? `<span class="sec-extra">${extra}</span>` : ""}</h3>${inner}</section>`;
  const kv = (rows) => `<dl class="kv2">${rows.filter((r) => r).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  const wrap = (table) => `<div class="tw">${table}</div>`;
  const row = (th, td, cls = "") => `<tr class="${cls}"><th class="rowh">${th}</th><td>${td}</td></tr>`;

  function aiBox(c, part) {
    const s = c.s;
    if (s && s[part] && s[part].body) return `<div class="ai"><span class="hl">${esc(s[part].headline)}</span><span class="body">${esc(s[part].body)}</span></div>`;
    if (c.summaryStatus === "pending" || c.summaryStatus === null) return `<span class="spinner">${t("generating")}</span>`;
    if (c.summaryStatus === "disabled") return `<span class="muted">${t("summaryDisabled")}</span>`;
    return `<span class="muted">${t("summaryError")}</span>`;
  }
  function updatedNote(c) {
    const s = c.s; if (!s) return "";
    const tr = (s.transcriptsUsed || [])[0];
    return `<p class="note">${esc(t("updatedNote", { period: tr ? tr.period : "—", date: tr ? fmtDate(tr.date) : "—", gen: fmtDate(s.generatedAt) }))}</p>`;
  }

  function financeBox(f, b) {
    if (!f) return "";
    const F = t("fin");
    const sgn = (v, d = 1) => (v === null || v === undefined ? NA : `${v > 0 ? "+" : ""}${fmtDec(v, d)}%`);
    const r = (k, v) => `<tr><th class="rowh">${k}</th><td class="num">${v}</td></tr>`;
    return `<table class="shk fin"><tr><th class="rowh"><b>【${t("financials")}】</b></th><th>&lt;${yymm(f.asOf)}&gt; ${t("unitM")}${fxNote(b)}</th></tr>
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
    return `<table class="shk ov">
      ${row(t("name"), `${esc(co.name)}${co.ceo ? `<span class="muted">　${t("ceo")}: ${esc(co.ceo)}</span>` : ""}`)}
      ${row(t("fiscalYear"), monthName(co.fiscalYearEndMonth))}
      ${row(t("ipo"), `${fmtDate(co.ipoDate, { month: "numeric", day: undefined })}${co.stateOfIncorporation ? `　<span class="muted">${t("incorporation")}: ${esc(co.stateOfIncorporation)}</span>` : ""}`)}
      ${row(t("feature"), feature)}
      ${row(t("segments"), co.segments.length ? co.segments.map((x) => `${esc(x.name)}${x.sharePct ?? "?"}`).join("、") + (co.segmentsFiscalYear ? ` <${co.segmentsFiscalYear}>` : "") : NA)}
      ${row(t("sector"), `${esc(co.sector || "")} / ${esc(co.industry || "")}${co.sicDescription ? `　<span class="muted">${t("sic")}: ${esc(co.sicDescription)} (${esc(co.sicCode)})</span>` : ""}`)}
      ${row(`<b>${t("story")}</b>`, aiBox(c, "story"))}
      ${row(`<b>${t("longTerm")}</b>`, aiBox(c, "longTerm"))}
      ${row(`<b>${t("recent")}</b>`, aiBox(c, "recent"))}
      ${row(`<b>${t("bull")}</b>`, aiBox(c, "bull"))}
      ${row(`<b>${t("bear")}</b>`, aiBox(c, "bear"))}
      ${row(t("hq"), esc(co.address || NA))}
      ${row(t("employees"), co.employees ? `${fmtInt(co.employees)}${isCJK() ? "名" : ""}${co.employeesAsOf ? ` <${yymm(co.employeesAsOf)}>` : ""}` : NA)}
      ${row(t("exchange"), `${esc(co.exchangeFullName || co.exchange)}${co.filerCategory ? `　<span class="muted">${esc(co.filerCategory)}</span>` : ""}${co.indices && co.indices.length ? `<br><span class="muted">${t("indexMember")}:</span> ${co.indices.map((x) => `<b>${esc(x.index)}</b>${x.weightPct !== null ? ` ${fmtDec(x.weightPct, 2)}%` : ""}`).join("　")}` : ""}`)}
      ${row(t("url"), co.website ? `<a href="${esc(co.website)}" target="_blank" rel="noopener">${esc(co.website)}</a>` : NA)}
      ${row(t("shares"), `${t("sharesOut")} ${fmtInt(m.sharesOutstandingM)}${t("millionShares")}　${t("marketCap")} ${fmtBig(m.marketCapM)}　${t("val.peFwd")} ${fmtDec(v.peForward, 1)}　${t("val.pe")} ${fmtDec(v.pe, 1)}　${t("pbr")} ${fmtDec(m.pbr, 1)}　${t("val.divYield")} ${fmtPct(m.dividendYieldPct, 2)}`)}
      ${row(t("opMargin"), `${fmtPct(b.growth.operatingMarginPct)}${b.growth.operatingMarginPrevPct !== null ? `(${b.growth.operatingMarginPct - b.growth.operatingMarginPrevPct >= 0 ? "+" : ""}${fmtDec(b.growth.operatingMarginPct - b.growth.operatingMarginPrevPct, 1)}pt)` : ""}　<span class="muted">${t("salesGrowth3y")}:</span> ${sg || NA}`)}
      ${row(t("competitors"), comps)}
      ${row(t("nextEarnings"), `${fmtDate(b.nextEarnings)}　<span class="muted">${t("analysts")}: ${rating}　${t("target")}: ${target}</span>`)}
    </table>
    ${updatedNote(c)}
    ${financeBox(f, b)}`;
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
    ]) + `<p class="note">${t("unitM")} · ( ) = ${isCJK() ? "前期" : "prior year"}${fxNote(c.b)}</p>`;
    const cfl = cf ? kv([[t("opCF"), pair(cf.operating, cf.operatingPrev)], [t("invCF"), pair(cf.investing, cf.investingPrev)], [t("finCF"), pair(cf.financing, cf.financingPrev)], [t("cashEq"), pair(cf.cash, cf.cashPrev)], [t("fcf"), fmtInt(cf.freeCashFlow)], [t("buyback"), fmtInt(cf.buybacks)], [t("divPaid"), fmtInt(cf.dividendsPaid)]]) + `<p class="note">FY${esc(cf.fiscalYear)} · ${t("unitM")}</p>` : NA;
    const bal = financeBox(f, c.b) || NA;
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

  // Current multiple against its own 5- and 10-year fiscal-year-end range.
  // "Reported in TWD, converted at 31.5 TWD per US dollar" for foreign filers.
  const fxNote = (b) => (b && b.company && b.company.fxToUsd ? ` · ${esc(t("fxNote", { cur: b.company.reportingCurrency, rate: fmtDec(b.company.fxToUsd, 2) }))}` : "");
  function multiplesHistoryHtml(h, V) {
    if (!h || !h.range5) return "";
    const H = V.history; const names = { pe: V.pe, ps: V.ps, pb: V.pb, evEbitda: V.evEbitda, pfcf: V.pfcf };
    const pos = (r) => { if (!r || r.now === null || r.now === undefined) return NA; if (r.now > r.high) return `<span class="down">${H.above}</span>`; if (r.now < r.low) return `<span class="up">${H.below}</span>`; const p = r.percentile; return p === null ? NA : p >= 67 ? H.highEnd : p <= 33 ? H.lowEnd : H.middle; };
    const rows = Object.entries(names).map(([k, label]) => { const r5 = h.range5[k], r10 = h.range10 && h.range10[k]; if (!r5 && !r10) return ""; const r = r5 || r10;
      return `<tr><th>${label}</th><td class="num"><b>${fmtDec(r.now, 1)}</b></td><td class="num">${r5 ? `${fmtDec(r5.low, 1)} / ${fmtDec(r5.median, 1)} / ${fmtDec(r5.high, 1)}` : NA}</td><td class="num">${r10 && r10.n > (r5 ? r5.n : 0) ? `${fmtDec(r10.low, 1)} / ${fmtDec(r10.median, 1)} / ${fmtDec(r10.high, 1)}` : NA}</td><td>${pos(r5 || r10)}</td></tr>`; }).join("");
    return sec(H.title, wrap(`<table class="tbl hist"><thead><tr><th>${H.metric}</th><th class="num">${H.now}</th><th class="num">${H.range5}</th><th class="num">${H.range10}</th><th>${H.position}</th></tr></thead><tbody>${rows}</tbody></table>`) + `<p class="note">${esc(H.note)}</p>`);
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
    const metrics = `<div class="grid3">${groups.map(([title, rows]) => sec(title, kv(rows))).join("")}</div>` + multiplesHistoryHtml(v.history, V);
    let dcfHtml;
    if (!d) dcfHtml = `<p class="muted">${V.noDcf}</p>`;
    else {
      const I = d.inputs; const up = d.upsidePct; const Y = d.story || {};
      const M = Y.impliedMoat;
      const moat = M ? `<div class="moat"><div class="stat-l">${V.moatYears}</div><div class="moat-num">${M.noExcess ? V.moatNoExcess : M.reached ? (M.years === 0 ? V.moatZero : t("val.moatN", { n: M.years })) : V.moatBeyond}</div><div class="muted small">${esc(t("val.moatNote", { roic: fmtPct(M.roic, 1), wacc: fmtPct(Y.waccMature, 1) }))}</div></div>` : "";
      const head = `<div class="dcf-head"><div class="dcf-value"><div class="stat-l">${V.perShare}</div><div class="dcf-num">$${x(d.perShare, 2)}</div><div class="${up >= 0 ? "up" : "down"}">${V.vsPrice} ${up >= 0 ? "+" : ""}${x(up)}% <span class="muted">($${x(d.price, 2)})</span></div>${moat}</div>
        <div><h4 class="sub">${V.story}</h4>${kv([
          [V.endRevenue, `${fmtBig(Y.endRevenue / 1e6)} <span class="muted">(${V.cagr} ${Y.revenueCagrPct >= 0 ? "+" : ""}${x(Y.revenueCagrPct)}%)</span>`],
          [V.targetMargin, `${fmtPct(Y.targetMarginPct)} <span class="muted">(${V.currentMargin} ${fmtPct(Y.currentMarginPct)})</span>`],
          [V.s2cPath, `${x(Y.salesToCapitalNow, 2)} → ${x(Y.salesToCapitalMature, 2)}`],
          [V.waccPath, `${fmtPct(Y.waccNow, 2)} → ${fmtPct(Y.waccMature, 2)} <span class="muted">(${V.costEquity} ${fmtPct(I.costEquity, 2)} = ${V.rf} ${fmtPct(I.riskFree, 2)} + β ${x(I.beta, 2)} × ${V.erp} ${fmtPct(I.erp, 1)}; ${V.costDebt} ${fmtPct(I.costDebt, 2)}, ${fmtPct(I.weightDebt * 100, 1)})</span>`],
          [V.failure, `${fmtPct(Y.failurePct, 1)} <span class="muted">(${esc(Y.rating || "")}; ${V.distress} ${fmtPct(Y.distressProceedsPct, 0)})</span>`],
          [V.terminalRoic, `${fmtPct(Y.terminalRoic, 1)} <span class="muted">(${V.currentRoic} ${fmtPct(Y.currentRoic, 1)}; WACC ${fmtPct(Y.waccMature, 1)} 〜 +5pt)</span>`],
          [V.g, fmtPct(I.g, 2)], [V.tax, `${fmtPct(I.taxRate)} → ${fmtPct(I.marginalTax, 0)}${I.nol > 0 ? ` <span class="muted">(${V.nolLabel} ${fmtBig(I.nol / 1e6)})</span>` : ""}`],
        ])}
        <h4 class="sub">${V.bridge}</h4>${kv([[V.goingConcern, fmtBig(d.goingConcernValue / 1e6)], [V.evLabel, fmtBig(d.enterpriseValue / 1e6)], [V.debtLeases, `−${fmtBig(I.debt / 1e6)}`], [V.cashNonOp, `+${fmtBig((I.cash + I.nonOperatingAssets) / 1e6)}`], I.minority ? [V.minority, `−${fmtBig(I.minority / 1e6)}`] : null, [V.equity, fmtBig(d.equityValue / 1e6)], [V.terminalShare, fmtPct(d.terminalShare * 100, 0)]].filter(Boolean))}</div></div>`;
      const yrs = wrap(`<table class="tbl"><thead><tr><th>${V.year}</th><th class="num">${V.rev}</th><th class="num">${V.growthCol}</th><th class="num">${V.ebit}</th><th class="num">${V.margin}</th><th class="num">${V.reinvest}</th><th class="num">${V.fcff}</th><th class="num">${V.waccCol}</th><th class="num">${V.pv}</th></tr></thead><tbody>${d.years.map((y) => `<tr class="${y.source === "consensus" ? "est" : ""}"><th>FY${esc(y.label)} <span class="muted small">${y.source === "consensus" ? V.consensus : V.extrap}</span></th><td class="num">${fmtInt(y.revenue / 1e6)}</td><td class="num">${y.growth >= 0 ? "+" : ""}${x(y.growth * 100)}%</td><td class="num">${fmtInt(y.ebit / 1e6)}</td><td class="num">${fmtPct(y.margin * 100)}</td><td class="num">${fmtInt(y.reinvestment / 1e6)}</td><td class="num">${fmtInt(y.fcff / 1e6)}</td><td class="num">${fmtPct(y.wacc, 1)}</td><td class="num">${fmtInt(y.pv / 1e6)}</td></tr>`).join("")}<tr class="sep"><th>${V.terminal}</th><td colspan="7" class="num muted">${fmtInt(d.terminalValue / 1e6)}</td><td class="num">${fmtInt(d.pvTerminal / 1e6)}</td></tr></tbody></table>`) + `<p class="note">${t("unitM")}</p>`;
      const S = d.sensitivity;
      const cell = (val, i, j) => `<td class="num ${i === 1 && j === 1 ? "base" : ""}">${val === null ? NA : "$" + x(val, 0)}</td>`;
      const sensStory = S && S.storyGrid ? wrap(`<table class="tbl sens"><thead><tr><th>${V.rev} \\ ${V.margin}</th>${S.storyAxis.margin.map((m) => `<th class="num">${fmtPct(m)}</th>`).join("")}</tr></thead><tbody>${S.storyGrid.map((r, i) => `<tr><th>${fmtBig(S.storyAxis.endRevenue[i] / 1e6)} <span class="muted small">(${S.storyAxis.cagr[i] >= 0 ? "+" : ""}${x(S.storyAxis.cagr[i])}%)</span></th>${r.map((val, j) => cell(val, i, j)).join("")}</tr>`).join("")}</tbody></table>`) + `<p class="note">${V.sensStoryNote}</p>` : "";
      const sens = S ? wrap(`<table class="tbl sens"><thead><tr><th>WACC \\ g</th>${S.gs.map((g) => `<th class="num">${fmtPct(g, 1)}</th>`).join("")}</tr></thead><tbody>${S.grid.map((r, i) => `<tr><th>${fmtPct(S.waccs[i], 1)}</th>${r.map((val, j) => cell(val, i, j)).join("")}</tr>`).join("")}</tbody></table>`) + `<p class="note">${V.sensNote}</p>` : "";
      dcfHtml = head + yrs + `<h4 class="sub">${V.sensStory}</h4>` + sensStory + `<h4 class="sub">${V.sens}</h4>` + sens + `<details class="method"><summary>${V.method}</summary>${V.methodBody.map((para) => `<p>${esc(para)}</p>`).join("")}</details>`;
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
    const dcfExtra = d && d.riskFreeDate ? `<span class="sec-extra">${V.rf}: ${fmtPct(d.inputs.riskFree, 2)} (${esc(d.riskFreeDate)})</span>` : "";
    const dcfCard = `<details class="card dcf-card"><summary class="sec"><span class="sec-t">${V.dcfTitle}</span>${dcfExtra} <span class="muted small">${V.dcfHint}</span></summary>${dcfHtml}</details>`;
    return `${sec(T.title, targetHtml)}<h3 class="sec plain">${V.title}</h3>${metrics}${dcfCard}`;
  }
  function bindTarget(c) {
    const root = c.root; if (!root) return;
    const input = root.querySelector("input.tpe"); if (!input) return;
    if (!c.demo) input.addEventListener("input", () => { if (!c._tpTracked) { c._tpTracked = true; track("target", state.symbol); } });
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

  // Composite support and resistance: the average of the AI's levels, with the move to each.
  function composite(tech, price) {
    const avg = (rows) => { const xs = (rows || []).map((r) => r.level).filter((x) => Number.isFinite(x) && x > 0); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
    const res = tech ? avg(tech.resistance) : null, sup = tech ? avg(tech.support) : null;
    const pct = (lv) => lv && price ? (lv / price - 1) * 100 : null;
    return { res, sup, upPct: pct(res), downPct: pct(sup) };
  }
  function tabTechnical(c) {
    const b = c.b; const v = b.valuation || {}; const K = t("tech"); const tech = c.s && c.s.technical;
    const lv = (rows, kind) => rows && rows.length ? `<table class="tbl"><thead><tr><th class="num">${K.level}</th><th>${K.reason}</th></tr></thead><tbody>${rows.slice().sort((p, q) => q.level - p.level).map((r) => `<tr><td class="num"><span class="lvl ${kind}">$${fmtDec(r.level, 1)}</span></td><td>${esc(r.reason)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">${NA}</p>`;
    const chart = `<div class="ranges" data-techranges>${["3m", "6m", "1y", "3y"].map((r) => `<button data-range="${r}" class="${r === (c.techRange || "1y") ? "active" : ""}">${t("ranges")[r]}</button>`).join("")}</div><div class="chart tech-chart" data-techchart></div>
      <p class="note legend"><span class="lg res"></span>${K.resistance}　<span class="lg sup"></span>${K.support}　<span class="lg ma50"></span>${K.ma50}　<span class="lg ma200"></span>${K.ma200}　<span class="lg px"></span>${K.current} $${fmtDec(v.price, 2)}</p>`;
    const ctx = kv([[K.current, `$${fmtDec(v.price, 2)}`], [K.high52, `$${fmtDec(v.yearHigh, 2)}${v.yearHighDate ? ` <span class="muted">(${fmtDate(v.yearHighDate)})</span>` : ""}`], [K.low52, `$${fmtDec(v.yearLow, 2)}${v.yearLowDate ? ` <span class="muted">(${fmtDate(v.yearLowDate)})</span>` : ""}`], v.allTimeHigh ? [K.ath, `$${fmtDec(v.allTimeHigh.price, 2)} <span class="muted">(${fmtDate(v.allTimeHigh.date)})</span>`] : null, [K.ma50, `$${fmtDec(v.priceAvg50, 2)}`], [K.ma200, `$${fmtDec(v.priceAvg200, 2)}`]]);
    const cp = composite(tech, v.price);
    const compo = tech && (cp.res || cp.sup) ? `<div class="composite"><div class="cpx res"><div class="stat-l">${K.compositeRes}</div><div class="cp-num">${cp.res ? `$${fmtDec(cp.res, 2)}` : NA}</div><div class="cp-move">${cp.upPct !== null ? `${K.upside} <b class="${cp.upPct >= 0 ? "up" : "down"}">${cp.upPct >= 0 ? "+" : ""}${fmtDec(cp.upPct, 1)}%</b>` : ""}</div></div>
        <div class="cpx px"><div class="stat-l">${K.current}</div><div class="cp-num">$${fmtDec(v.price, 2)}</div><div class="cp-move muted">${K.compositeNote}</div></div>
        <div class="cpx sup"><div class="stat-l">${K.compositeSup}</div><div class="cp-num">${cp.sup ? `$${fmtDec(cp.sup, 2)}` : NA}</div><div class="cp-move">${cp.downPct !== null ? `${K.downside} <b class="${cp.downPct >= 0 ? "up" : "down"}">${cp.downPct >= 0 ? "+" : ""}${fmtDec(cp.downPct, 1)}%</b>` : ""}</div></div></div>` : "";
    const read = tech
      ? `${compo}<div class="grid2b"><div><h4 class="sub">${K.resistance}</h4>${wrap(lv(tech.resistance, "res"))}</div><div><h4 class="sub">${K.support}</h4>${wrap(lv(tech.support, "sup"))}</div></div><p class="tech-comment">${esc(tech.comment)}</p>${updatedNote(c)}`
      : `<p class="muted" style="margin:8px">${c.summaryStatus === "pending" || c.summaryStatus === null ? t("generating") : t("summaryError")}</p>`;
    return `${sec(K.title, chart + read, `$${fmtDec(v.price, 2)}`)}${sec(K.context, ctx)}`;
  }
  async function loadTechChart(c) {
    const el = c.root && c.root.querySelector("[data-techchart]"); if (!el) return;
    const range = c.techRange || "1y"; const key = `${c.b.symbol}:${range}`;
    c.techCache = c.techCache || {};
    if (!c.techCache[key]) {
      el.innerHTML = `<div class="spinner">…</div>`;
      try { const r = await api(`/api/chart/${encodeURIComponent(c.b.symbol)}?range=${range}`); c.techCache[key] = { points: r.points, ma50: r.ma50, ma200: r.ma200 }; c.chartCache[key] = c.chartCache[key] || r.points; } catch (e) { el.innerHTML = `<div class="error">${t("loadError")}</div>`; return; }
      if (!document.body.contains(el)) return;
    }
    const v = c.b.valuation || {}; const K = t("tech"); const tech = c.s && c.s.technical; const ch = c.techCache[key];
    // Two lines only: the composite resistance and the composite support (averages of the AI's levels).
    const cp = composite(tech, v.price);
    const levels = [];
    if (cp.res) levels.push({ price: cp.res, kind: "res", label: `${K.resistance.split("（")[0]} $${fmtDec(cp.res, 1)}${cp.upPct !== null ? ` (${cp.upPct >= 0 ? "+" : ""}${fmtDec(cp.upPct, 1)}%)` : ""}` });
    if (cp.sup) levels.push({ price: cp.sup, kind: "sup", label: `${K.support.split("（")[0]} $${fmtDec(cp.sup, 1)}${cp.downPct !== null ? ` (${cp.downPct >= 0 ? "+" : ""}${fmtDec(cp.downPct, 1)}%)` : ""}` });
    const bands = [];
    const series = [];
    if (ch.ma50) series.push({ points: ch.ma50, color: "#d08c1a", label: K.ma50 });
    if (ch.ma200) series.push({ points: ch.ma200, color: "#6b4fbb", label: K.ma200 });
    window.renderChart(el, ch.points, { locale: state.locale, height: el.clientWidth < 600 ? 320 : 420, levels, bands, series, current: v.price });
  }
  // Shared renderer for the company deep dive and the sector reports (same report shape).
  function researchHtml(d, D, opts = {}) {
    const F = d.findings || {};
    const names = opts.findingNames || D.f;
    const card = (key, f) => f ? `<div class="finding"><div class="f-head"><span class="f-title">${names[key]}</span><span class="pill asm ${esc(String(f.assessment).toLowerCase()).replace(/[^a-z]/g, "")}">${esc(D.asm[String(f.assessment).toLowerCase()] || f.assessment)}</span><span class="muted small">${D.conf[String(f.confidence).toLowerCase()] || esc(f.confidence)}</span></div>
      <p class="f-mech">${esc(f.mechanism)}</p>
      <p><b>${D.evidence}:</b> ${esc(f.evidence)}</p><p><b>${D.counter}:</b> ${esc(f.counterevidence)}</p><p class="f-dec"><b>${D.decisive}:</b> ${esc(f.decisive)}</p></div>` : "";
    const findings = `<div class="findings">${card("quality", F.quality)}${card("trajectory", F.trajectory)}${card("valuation", F.valuation)}</div>${F.divergences ? `<p class="divergences"><b>${D.divergences}:</b> ${esc(F.divergences)}</p>` : ""}`;
    const bf = wrap(`<table class="tbl deep-bf"><thead><tr><th>${D.segment}</th><th>${D.revenueShare}</th><th>${D.competitors}</th><th>${D.purchaseCriteria}</th><th>${D.position}</th></tr></thead><tbody>${(d.battlefields || []).map((b) => `<tr><th>${esc(b.segment)}</th><td data-l="${D.revenueShare}">${esc(b.revenueShare)}</td><td data-l="${D.competitors}">${esc(b.competitors)}</td><td data-l="${D.purchaseCriteria}">${esc(b.purchaseCriteria)}</td><td data-l="${D.position}">${esc(b.position)}</td></tr>`).join("")}</tbody></table>`);
    const story = d.story ? `<div class="deep-story"><div class="hl">${esc(d.story.headline)}</div><p>${esc(d.story.body)}</p></div>` : "";
    const secs = Object.fromEntries((d.sections || []).map((x) => [x.key, x]));
    const piece = (k) => secs[k] ? `<div class="ai"><span class="hl">${esc(secs[k].headline)}</span><span class="body">${esc(secs[k].body)}</span></div>` : "";
    const rows = ["history", "detective", "moat", "outlook", "cycle", "management", "valuationDetail", "consensus"].filter((k) => secs[k]).map((k) => row(`<b>${D[k]}</b>`, piece(k))).join("");
    const cons = d.constituents && d.constituents.length ? sec(D.constituentReads, wrap(`<table class="tbl"><thead><tr><th>${D.symbol}</th><th>${D.role}</th><th>${D.read}</th></tr></thead><tbody>${d.constituents.map((x) => `<tr><th><a href="#/s/${esc(x.symbol)}">${esc(x.symbol)}</a></th><td>${esc(x.role)}</td><td>${esc(x.read)}</td></tr>`).join("")}</tbody></table>`)) : "";
    const risks = wrap(`<table class="tbl"><thead><tr><th>${D.risk}</th><th>${D.indicator}</th><th>${D.affects}</th></tr></thead><tbody>${(d.risks || []).map((r) => `<tr><td>${esc(r.risk)}</td><td>${esc(r.indicator)}</td><td class="c"><span class="tag">${esc(r.finding)}</span></td></tr>`).join("")}</tbody></table>`);
    const qs = `<ol class="imps">${(d.questions || []).map((q) => `<li>${esc(q)}</li>`).join("")}</ol>`;
    const cps = wrap(`<table class="tbl cps"><thead><tr><th>${D.premise}</th><th>${D.kpi}</th><th>${D.latest}</th><th>${D.failure}</th><th>${D.next}</th></tr></thead><tbody>${(d.checkpoints || []).map((x) => `<tr><td>${esc(x.premise)} <span class="tag">${esc(x.finding)}</span></td><td>${esc(x.kpi)}</td><td>${esc(x.latest)}</td><td>${esc(x.failure)}</td><td>${esc(x.next)}</td></tr>`).join("")}</tbody></table>`);
    const note = `<p class="note"><b>${D.caveats}:</b> ${esc(d.caveats)}</p><p class="note">${opts.updated || ""} ${esc(D.noAdvice)}</p>`;
    return `${sec(opts.storyTitle || D.storyTitle, story + `<h4 class="sub">${opts.battlefieldsTitle || D.battlefields}</h4>` + bf)}
      ${sec(D.findingsTitle, findings)}
      <table class="shk ov">${rows}</table>
      ${cons}
      ${sec(D.risks, risks)}
      ${sec(D.questions, qs)}
      ${sec(D.checkpoints, cps)}
      <section class="card">${note}</section>`;
  }
  function tabDeep(c) {
    const D = t("deep"); const d = c.d;
    if (!d) {
      const msg = c.deepStatus === "disabled" ? t("summaryDisabled") : c.deepStatus === "error" ? t("summaryError") : `<span class="spinner">${D.generating}</span>`;
      return `<section class="card"><h3 class="sec"><span class="sec-t">${D.title}</span></h3><p class="muted" style="margin:8px">${esc(D.intro)}</p><p style="margin:8px">${msg}</p></section>`;
    }
    const tr = (d.transcriptsUsed || [])[0];
    return `${sec(D.title, `<p class="muted deep-intro">${esc(D.intro)} <b>${esc(D.readTime)}</b></p>`)}` + researchHtml(d, D, { updated: esc(t("updatedNote", { period: tr ? tr.period : "—", date: tr ? fmtDate(tr.date) : "—", gen: fmtDate(d.generatedAt) })) });
  }
  function stopSummaryPolling(c) { if (c && c.timer) clearTimeout(c.timer); if (c) c.timer = null; }
  function applySummary(c, r, lang) {
    c.summaryStatus = r.status;
    if (r.status === "ready") { c.s = r.summary; c.tries = 0; }
    if (c.root && (c.tab === 0 || c.tab === 2 || c.tab === 3)) renderTab(c);
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

  function stopDeepPolling(c) { if (c && c.deepTimer) clearTimeout(c.deepTimer); if (c) c.deepTimer = null; }
  function applyDeep(c, r) {
    c.deepStatus = r.status;
    if (r.status === "ready") { c.d = r.summary; c.deepTries = 0; }
    if (c.root && c.tab === 5) renderTab(c);
    if (r.status === "pending" && (c.deepTries || 0) < 40) { c.deepTries = (c.deepTries || 0) + 1; c.deepTimer = setTimeout(() => loadDeep(c), 6000); }
  }
  async function loadDeep(c) {
    stopDeepPolling(c);
    const symbol = c.b && c.b.symbol; const lang = state.locale;
    if (!symbol) return;
    if (!state.config.summariesEnabled) { c.deepStatus = "disabled"; if (c.root && c.tab === 5) renderTab(c); return; }
    try {
      const r = c.demo ? (await api(`/api/demo?lang=${encodeURIComponent(lang)}`)).deep : await api(`/api/deep/${encodeURIComponent(symbol)}?lang=${encodeURIComponent(lang)}`);
      if (c.b.symbol !== symbol || lang !== state.locale) return;
      applyDeep(c, r || { status: "error" });
    } catch (e) {
      c.deepStatus = "error"; if (c.root && c.tab === 5) renderTab(c);
    }
  }

  // ---------- landing sample (live page, no login) ----------
  async function mountDemo(container) {
    const c = state.demo;
    stopSummaryPolling(c);
    container.innerHTML = `<div class="spinner">…</div>`;
    try {
      const r = await api(`/api/demo?lang=${encodeURIComponent(state.locale)}`);
      c.b = r.bundle; c.s = null; c.summaryStatus = null; c.d = null; c.deepStatus = null; c.tab = 0;
      c.chartCache = Object.fromEntries(Object.entries(r.charts).map(([k, ch]) => [`${r.bundle.symbol}:${k}`, Array.isArray(ch) ? ch : ch.points]));
      c.techCache = Object.fromEntries(Object.entries(r.charts).filter(([, ch]) => !Array.isArray(ch)).map(([k, ch]) => [`${r.bundle.symbol}:${k}`, ch]));
      if (!document.body.contains(container)) return;
      mountStock(container, c);
      applySummary(c, r.summary, state.locale);
      if (r.deep) applyDeep(c, r.deep);
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
    try { state.config = await api("/api/config"); } catch { state.config = { locales: ["ja", "en"], defaultLocale: "ja", trialDays: 7, priceLabel: "US$10", billingEnabled: false, summariesEnabled: false }; }
    try { const me = await api("/api/auth/me"); state.user = me.user; state.ent = me.entitlement; } catch {}
    let loc = null;
    if (state.user) loc = state.user.locale; // a member's saved language
    if (!loc) { try { loc = sessionStorage.getItem("locale"); } catch {} } // a visitor's toggle, this session only
    if (!loc) loc = state.config.defaultLocale; // site default (Japanese on the JP site), never the browser language
    state.route = parseRoute();
    applyBrand();
    setLocale(loc, false);
  }
  init();
})();
