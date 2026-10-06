// The admin area: one page over /api/admin (and /api/admin/dq, the data-quality module's). Hash routes, no framework,
// no inline scripts or handlers (the page's CSP allows only this file). Everything from the server goes through the
// html`` tag below, which escapes every interpolated value, so emails, notes, tickers and prompt text stay text.
(function () {
  "use strict";
  const A = "/api/admin";

  // ---------- escaping and formatting ----------
  const esc = (s) => (s === null || s === undefined || s === false ? "" : String(s)).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const raw = (s) => new Raw(s);
  const show = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(show).join("") : esc(v));
  const html = (strings, ...vals) => raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? show(vals[i]) : ""), ""));

  const DASH = "—";
  const int = (n) => (n === null || n === undefined ? DASH : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }));
  // Claude cost: cents are too coarse for single calls, so 4 decimals below $10 (fixed, so columns line up)
  const usd = (v) => { if (v === null || v === undefined) return DASH; const d = !v || Math.abs(v) >= 10 ? 2 : 4; return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); };
  const usd2 = (v) => (v === null || v === undefined ? DASH : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pct = (x) => (x === null || x === undefined ? DASH : Math.round(x * 100) + "%");
  const bytes = (n) => { n = Number(n) || 0; return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB"; };
  // Stripe amounts are in minor units; Intl knows how many decimals each currency has (JPY none, USD two)
  function money(minor, currency) {
    const cur = String(currency || "usd").toUpperCase();
    try {
      const f = new Intl.NumberFormat("en-US", { style: "currency", currency: cur });
      return f.format((Number(minor) || 0) / 10 ** f.resolvedOptions().maximumFractionDigits);
    } catch (e) { return int(minor) + " " + cur; }
  }
  const moneyMap = (m) => { const e = Object.entries(m || {}); return e.length ? e.map(([c, v]) => money(v, c)).join(" · ") : DASH; };
  const pad = (n) => String(n).padStart(2, "0");
  const when = (iso) => { if (!iso) return DASH; const d = new Date(iso); if (isNaN(d)) return iso; return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const day = (iso) => (iso ? String(iso).slice(0, 10) : DASH);
  function ago(iso) {
    if (!iso) return DASH;
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (!isFinite(s)) return iso;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    if (s < 86400 * 30) return Math.floor(s / 86400) + " d ago";
    return day(iso);
  }
  const timeCell = (iso, rel) => html`<span class="nowrap" title="${iso || ""}">${rel ? ago(iso) : when(iso)}</span>`;
  const limitText = (used, lim) => (lim === null || lim === undefined ? `${int(used)} / no limit` : `${int(used)} / ${int(lim)}`);

  // ---------- API ----------
  async function api(method, path, body) {
    const init = { method, credentials: "same-origin", headers: { accept: "application/json" } };
    // the server's origin guard wants JSON on every write, even an empty one
    if (method !== "GET") { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body || {}); }
    const res = await fetch(path, init);
    let data = null;
    if (/json/.test(res.headers.get("content-type") || "")) data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = new Error((data && data.message) || (res.status === 404 ? "Not found." : "Request failed (HTTP " + res.status + ")."));
      e.status = res.status; e.code = (data && data.code) || (res.status === 404 ? "not_found" : "http_" + res.status); e.body = data;
      throw e;
    }
    return data;
  }

  // ---------- page state ----------
  const S = { me: null, admin: null, overview: null, plans: null, usersQuery: { q: "", role: "", status: "", offset: 0 }, seq: 0 };
  const isOwner = () => S.admin && S.admin.role === "owner";
  const OWNER_ONLY = "Only the owner can change this";
  const ownerAttr = (extra) => raw(!isOwner() || extra ? ` disabled title="${esc(extra || OWNER_ONLY)}"` : "");

  let toastTimer;
  function toast(msg, kind) {
    let el = document.getElementById("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = msg; el.className = kind || ""; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, kind === "bad" ? 8000 : 4000);
  }

  // ---------- gates: not signed in, not an admin, TOTP step-up ----------
  const root = () => document.getElementById("root");
  function gate(inner) { root().innerHTML = html`<div class="gate"><div class="card gate-card stack">${inner}</div></div>`.s; }

  function signInGate() {
    gate(html`<h1>Admin</h1><p>Sign in to the app first, then come back here.</p><p><a class="btn primary" href="/">Sign in</a></p>`);
  }
  function notAdminGate(email) {
    gate(html`<h1>Admins only</h1><p>${email ? "You're signed in as " + email + ", which isn't an admin account." : "This account isn't an admin."}</p><p><a href="/">Back to the app</a></p>`);
  }
  function errorGate(e) {
    gate(html`<h1>Admin</h1><p class="err">${e.message}</p><p><button class="btn" type="button" id="retry">Try again</button></p>`);
    document.getElementById("retry").addEventListener("click", () => location.reload());
  }

  function mfaGate() {
    const enrolled = S.admin ? S.admin.mfa.enrolled : !!(S.me && S.me.mfa);
    const codeForm = (label, action) => html`
      <form id="totp-form" class="stack" novalidate>
        <label class="field" for="totp-code">${label}</label>
        <input id="totp-code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
        <div class="err" role="alert" id="totp-err"></div>
        <button class="btn primary" type="submit">${action}</button>
      </form>`;
    const bindCode = (path) => {
      const f = document.getElementById("totp-form"), inp = document.getElementById("totp-code"), err = document.getElementById("totp-err");
      setTimeout(() => inp.focus(), 0);
      f.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const btn = f.querySelector("button"); btn.disabled = true; err.textContent = "";
        try { await api("POST", path, { code: inp.value.trim() }); location.reload(); }
        catch (e) { err.textContent = e.message; btn.disabled = false; inp.select(); }
      });
    };
    if (enrolled) {
      gate(html`<h1>Authenticator code</h1><p class="muted">The admin area asks for a code from your authenticator app once per session.</p>${codeForm("Six-digit code", "Open the admin area")}
        <p class="small muted">Signed in as ${S.me.email}. <a href="/">Back to the app</a></p>`);
      bindCode("/auth/totp/verify");
      return;
    }
    gate(html`<h1>Set up an authenticator</h1>
      <p class="muted">The admin area needs a second step: a six-digit code from an authenticator app (1Password, Google Authenticator, Authy…).</p>
      <p><button class="btn primary" type="button" id="totp-setup">Create a secret</button></p>
      <div class="err" role="alert" id="setup-err"></div>
      <div id="totp-step"></div>
      <p class="small muted">Signed in as ${S.me.email}. <a href="/">Back to the app</a></p>`);
    document.getElementById("totp-setup").addEventListener("click", async (ev) => {
      ev.currentTarget.disabled = true;
      try {
        const s = await api("POST", "/auth/totp/setup", {});
        document.getElementById("totp-step").innerHTML = html`
          <div class="stack">
            <p>Add this key to your authenticator app (choose “enter a setup key”, time-based):</p>
            <div class="secret mono">${s.secret.replace(/(.{4})/g, "$1 ").trim()}</div>
            <p class="small muted">Or paste the full setup URI into an app that accepts one:</p>
            <div class="uri mono">${s.otpauth}</div>
            ${codeForm("Then enter the code the app shows", "Turn on and continue")}
          </div>`.s;
        ev.target.closest("p").hidden = true;
        bindCode("/auth/totp/enable");
      } catch (e) {
        ev.target.disabled = false;
        // a second tab may have finished the setup already
        if (e.code === "already_enrolled") { S.admin && (S.admin.mfa.enrolled = true); mfaGate(); return; }
        document.getElementById("setup-err").textContent = e.message;
      }
    });
  }

  // ---------- shell and routing ----------
  const NAV = [["overview", "Overview"], ["users", "Users"], ["allowlist", "Allowlist"], ["usage", "Usage"], ["cache", "Cache"], ["prompts", "Prompts"],
    ["flags", "Flags"], ["dq", "Data quality"], ["logs", "Logs"], ["settings", "Settings"], ["plans", "Plans"]];
  let main;
  function shell() {
    root().innerHTML = html`<div class="shell">
      <header class="top">
        <a class="brand" href="#overview">Company model <span>Admin</span></a>
        <span class="who">${S.admin.email} · ${S.admin.role}</span>
        <a class="btn small" href="/">Open app</a>
        <button class="btn small" type="button" id="logout">Sign out</button>
      </header>
      <aside class="side"><nav id="nav" aria-label="Admin sections">${NAV.map(([k, label]) => html`<a href="#${k}" data-nav="${k}">${label}<span class="count" data-count="${k}" hidden></span></a>`)}</nav></aside>
      <main id="main" tabindex="-1"></main>
    </div>`.s;
    main = document.getElementById("main");
    document.getElementById("nav").addEventListener("click", (ev) => { const a = ev.target.closest("a[data-nav]"); if (a && a.getAttribute("href") === location.hash) { ev.preventDefault(); rerender(); } });
    document.getElementById("logout").addEventListener("click", async () => { try { await api("POST", "/auth/logout", {}); } catch (e) {} location.href = "/"; });
    // one set of delegated listeners; each view registers its handlers by name
    main.addEventListener("click", (ev) => {
      const el = ev.target.closest("[data-act]");
      if (!el || !main.contains(el) || el.disabled) return;
      const fn = H.click[el.dataset.act];
      if (fn) { ev.preventDefault(); busy(el, () => fn(el, ev)); }
    });
    main.addEventListener("submit", (ev) => {
      const f = ev.target.closest("form[data-form]");
      if (!f) return;
      ev.preventDefault();
      const fn = H.submit[f.dataset.form];
      // read the fields before busy() disables them (disabled controls drop out of FormData)
      const data = formData(f);
      if (fn) busy(f, () => fn(f, data));
    });
    main.addEventListener("change", (ev) => {
      const el = ev.target.closest("[data-change]");
      if (!el) return;
      const fn = H.change[el.dataset.change];
      if (fn) busy(el, () => fn(el, ev));
    });
    main.addEventListener("input", (ev) => { const el = ev.target.closest("[data-input]"); if (el && H.input[el.dataset.input]) H.input[el.dataset.input](el, ev); });
    window.addEventListener("hashchange", () => route());
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(redrawCharts, 120); });
    updateCounts();
  }
  let H = { click: {}, submit: {}, change: {}, input: {} };
  const formData = (f) => Object.fromEntries(new FormData(f).entries());
  async function busy(el, fn) {
    const ctl = el.tagName === "FORM" ? [...el.querySelectorAll("button, input, select, textarea")] : [el];
    const was = ctl.map((x) => x.disabled);
    ctl.forEach((x) => { x.disabled = true; });
    try { await fn(); }
    catch (e) { toast(e.message || String(e), "bad"); }
    finally { ctl.forEach((x, i) => { if (x.isConnected) x.disabled = was[i]; }); }
  }

  function updateCounts() {
    const o = S.overview; if (!o) return;
    const set = (k, n) => { const el = document.querySelector(`[data-count="${k}"]`); if (el) { el.textContent = n; el.hidden = !n; } };
    set("dq", o.dq_open); set("logs", o.errors_24h);
  }

  const VIEWS = {};
  function parseHash() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, "")) || "overview";
    const [path, qs] = h.split("?");
    return { parts: path.split("/").filter(Boolean), query: new URLSearchParams(qs || "") };
  }
  async function route(keepScroll) {
    const { parts, query } = parseHash();
    const name = VIEWS[parts[0]] ? parts[0] : "overview";
    document.querySelectorAll("[data-nav]").forEach((a) => { if (a.dataset.nav === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    const seq = ++S.seq;
    main.classList.add("loading");
    const y = window.scrollY;
    try {
      const handlers = { click: {}, submit: {}, change: {}, input: {} }, slots = [];
      const out = await VIEWS[name]({ parts: parts.slice(1), query, on: handlers, charts: slots });
      if (seq !== S.seq) return; // a newer navigation won
      H = handlers; charts = slots;
      main.innerHTML = show(out);
      charts.forEach((c) => drawChart(c));
      document.title = (NAV.find((n) => n[0] === name) || ["", "Admin"])[1] + " · Admin";
      if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
    } catch (e) {
      if (seq !== S.seq) return;
      if (e.code === "mfa_required") { mfaGate(); return; }
      if (e.status === 401) { signInGate(); return; }
      main.innerHTML = html`<div class="banner bad">${e.message}</div>`.s;
    } finally { if (seq === S.seq) main.classList.remove("loading"); }
  }
  const rerender = () => route(true);
  const go = (hash) => { if (location.hash === hash) rerender(); else location.hash = hash; };
  const confirmed = (msg) => window.confirm(msg);

  // ---------- small view helpers ----------
  const tile = (label, value, sub, href, extra) => html`<${raw(href ? "a" : "div")} class="tile"${raw(href ? ` href="${esc(href)}"` : "")}><div class="label">${label}</div><div class="value">${value}</div>${sub ? html`<div class="sub">${sub}</div>` : ""}${extra || ""}</${raw(href ? "a" : "div")}>`;
  const meter = (used, cap) => {
    if (!cap) return "";
    const f = Math.max(0, Math.min(1, used / cap));
    return html`<div class="meter ${f >= 1 ? "bad" : f >= 0.8 ? "warn" : ""}" role="img" aria-label="${pct(f)} of the cap"><i style="width:${(f * 100).toFixed(1)}%"></i></div>`;
  };
  const roleBadge = (r) => html`<span class="badge ${r === "owner" ? "acc" : r === "admin" ? "warn" : ""}">${r}</span>`;
  const statusBadge = (s) => html`<span class="badge ${s === "active" ? "ok" : "bad"}">${s === "disabled" ? "suspended" : s}</span>`;
  const yesNo = (v, yes = "yes", no = "no") => html`<span class="badge ${v ? "ok" : ""}">${v ? yes : no}</span>`;
  const table = (head, rows, empty) => rows.length
    ? html`<div class="wrap"><table class="t"><thead><tr>${head.map((h) => (Array.isArray(h) ? html`<th class="${h[1]}">${h[0]}</th>` : html`<th>${h}</th>`))}</tr></thead><tbody>${rows}</tbody></table></div>`
    : html`<p class="empty">${empty || "Nothing here yet."}</p>`;
  const jsonBlock = (v, label) => (v === null || v === undefined ? "" : html`<details><summary>${label || (typeof v === "object" ? Object.keys(v).slice(0, 4).join(", ") || "{}" : String(v).slice(0, 40))}</summary><pre>${typeof v === "string" ? v : JSON.stringify(v, null, 2)}</pre></details>`);
  const licenceBanner = (licensed) => (licensed ? "" : html`<div class="banner warn"><b>Personal phase.</b> Only the owner can sign in until the FMP display licence is recorded in <a href="#settings">Settings</a>. Invites can be added now; invited people can't sign in until then.</div>`);
  async function loadPlans() { if (!S.plans) S.plans = await api("GET", A + "/plans"); return S.plans; }

  // ---------- charts: one series of columns per day, with hover and focus readouts ----------
  // The table under each chart has every value, so the tooltip only adds convenience.
  let charts = [];
  function chartSlot(list, id, title, sub, rows, fmt) {
    list.push({ id, rows, fmt });
    return html`<p class="chart-title">${title}</p>${sub ? html`<p class="chart-sub">${sub}</p>` : ""}<div class="chart" id="${id}" role="img" aria-label="${title}"></div>`;
  }
  function niceStep(max, ticks) {
    const raw0 = max / ticks, mag = 10 ** Math.floor(Math.log10(raw0)), f = raw0 / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  }
  function drawChart(c) {
    const el = document.getElementById(c.id);
    if (!el) return;
    const rows = c.rows, n = rows.length;
    const max = Math.max(0, ...rows.map((r) => r.v));
    if (!n || max <= 0) { el.innerHTML = html`<p class="empty">No activity in this window.</p>`.s; return; }
    const W = Math.max(280, el.clientWidth), Hh = 168, padL = 52, padR = 4, padT = 8, padB = 22;
    const step = niceStep(max, 4), top = Math.ceil(max / step) * step;
    const dec = Math.min(4, (String(+step.toFixed(6)).split(".")[1] || "").length);
    const plotW = W - padL - padR, plotH = Hh - padT - padB, slot = plotW / n;
    const bw = Math.max(1, Math.min(24, slot - 2)), r = Math.min(4, bw / 2);
    const y = (v) => padT + plotH - (v / top) * plotH;
    let s = "";
    for (let t = 0; t <= top + step / 2; t += step) {
      s += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`;
      s += `<text class="axis" x="${padL - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${esc(c.fmt.axis(t, dec))}</text>`;
    }
    rows.forEach((row, i) => {
      const x = padL + i * slot + (slot - bw) / 2, h = (row.v / top) * plotH, yy = padT + plotH - h;
      if (h > 0) {
        const rr = Math.min(r, h);
        // square at the baseline, rounded at the data end
        s += `<path class="bar" data-i="${i}" d="M${x.toFixed(1)},${(padT + plotH).toFixed(1)}V${(yy + rr).toFixed(1)}A${rr},${rr} 0 0 1 ${(x + rr).toFixed(1)},${yy.toFixed(1)}H${(x + bw - rr).toFixed(1)}A${rr},${rr} 0 0 1 ${(x + bw).toFixed(1)},${(yy + rr).toFixed(1)}V${(padT + plotH).toFixed(1)}Z"/>`;
      }
      s += `<rect class="hit" data-i="${i}" tabindex="0" x="${(padL + i * slot).toFixed(1)}" y="${padT}" width="${slot.toFixed(1)}" height="${plotH}" aria-label="${esc(row.label + ": " + c.fmt.value(row.v))}"/>`;
    });
    const labelAt = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
    for (const i of labelAt) {
      const x = padL + i * slot + slot / 2;
      s += `<text class="axis" x="${x.toFixed(1)}" y="${Hh - 6}" text-anchor="${i === 0 && n > 1 ? "start" : i === n - 1 && n > 1 ? "end" : "middle"}">${esc(rows[i].label.slice(5))}</text>`;
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}">${s}</svg>`;
    const tip = tipEl();
    const showTip = (target, px, py) => {
      const i = +target.dataset.i, row = rows[i];
      el.classList.add("hovering");
      el.querySelectorAll(".bar").forEach((b) => b.classList.toggle("on", +b.dataset.i === i));
      tip.textContent = "";
      const b = document.createElement("b"); b.textContent = c.fmt.value(row.v);
      const sp = document.createElement("span"); sp.textContent = row.label + (row.note ? " · " + row.note : "");
      tip.append(b, sp); tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.max(8, Math.min(window.innerWidth - tw - 8, px - tw / 2)) + "px";
      tip.style.top = Math.max(8, py - th - 12) + "px";
    };
    const hide = () => { tip.hidden = true; el.classList.remove("hovering"); };
    el.querySelectorAll(".hit").forEach((h) => {
      h.addEventListener("pointermove", (e) => showTip(h, e.clientX, e.clientY));
      h.addEventListener("pointerleave", hide);
      h.addEventListener("focus", () => { const b = h.getBoundingClientRect(); showTip(h, b.left + b.width / 2, b.top + 20); });
      h.addEventListener("blur", hide);
    });
  }
  function tipEl() { let t = document.getElementById("tip"); if (!t) { t = document.createElement("div"); t.id = "tip"; t.className = "tip"; t.hidden = true; document.body.appendChild(t); } return t; }
  function redrawCharts() { charts.forEach((c) => drawChart(c)); }

  // ---------- line diff (LCS) for prompt versions ----------
  function lineDiff(a, b) {
    const A0 = a.split("\n"), B0 = b.split("\n");
    let pre = 0;
    while (pre < A0.length && pre < B0.length && A0[pre] === B0[pre]) pre++;
    let suf = 0;
    while (suf < A0.length - pre && suf < B0.length - pre && A0[A0.length - 1 - suf] === B0[B0.length - 1 - suf]) suf++;
    const a2 = A0.slice(pre, A0.length - suf), b2 = B0.slice(pre, B0.length - suf), n = a2.length, m = b2.length;
    const ops = [];
    for (let i = 0; i < pre; i++) ops.push([" ", A0[i]]);
    if (n * m > 4e6) { a2.forEach((l) => ops.push(["-", l])); b2.forEach((l) => ops.push(["+", l])); }
    else {
      // L[i][j] = length of the longest common subsequence of a2[i..] and b2[j..]
      const W = m + 1, L = new Uint32Array((n + 1) * W);
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * W + j] = a2[i] === b2[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (a2[i] === b2[j]) { ops.push([" ", a2[i]]); i++; j++; }
        else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) ops.push(["-", a2[i++]]);
        else ops.push(["+", b2[j++]]);
      }
      while (i < n) ops.push(["-", a2[i++]]);
      while (j < m) ops.push(["+", b2[j++]]);
    }
    for (let i = A0.length - suf; i < A0.length; i++) ops.push([" ", A0[i]]);
    return ops;
  }
  function diffView(a, b) {
    const ops = lineDiff(a, b);
    const added = ops.filter((o) => o[0] === "+").length, removed = ops.filter((o) => o[0] === "-").length;
    if (!added && !removed) return html`<p class="empty">Same text as version 1.</p>`;
    let oldN = 0, newN = 0;
    const lines = ops.map(([op, text]) => { if (op !== "+") oldN++; if (op !== "-") newN++; return { op, text, o: op === "+" ? "" : oldN, n: op === "-" ? "" : newN }; });
    // long unchanged runs fold to their first and last three lines
    const out = [];
    for (let i = 0; i < lines.length;) {
      if (lines[i].op !== " ") { out.push(lines[i++]); continue; }
      let j = i; while (j < lines.length && lines[j].op === " ") j++;
      const run = lines.slice(i, j);
      if (run.length > 8) { out.push(...run.slice(0, i === 0 ? 0 : 3), { skip: run.length - (i === 0 ? 0 : 3) - (j === lines.length ? 0 : 3) }, ...run.slice(j === lines.length ? run.length : run.length - 3)); }
      else out.push(...run);
      i = j;
    }
    return html`<p class="small muted">${added} line${added === 1 ? "" : "s"} added, ${removed} removed, compared with version 1.</p>
      <div class="diff">${out.map((l) => (l.skip
        ? html`<div class="skip"><span class="ln"></span><span class="ln"></span><span></span><span class="tx">${l.skip} unchanged line${l.skip === 1 ? "" : "s"}</span></div>`
        : html`<div class="${l.op === "+" ? "add" : l.op === "-" ? "del" : ""}"><span class="ln">${l.o}</span><span class="ln">${l.n}</span><span>${l.op === " " ? "" : l.op === "-" ? "−" : "+"}</span><span class="tx">${l.text || " "}</span></div>`))}</div>`;
  }

  // ======================================================================================================== views

  VIEWS.overview = async () => {
    const o = await api("GET", A + "/overview");
    S.overview = o; updateCounts();
    const st = o.state, cap = o.claude.budget_day_usd;
    const lic = (k, label) => html`<tr><th>${label}</th><td>${st.licences[k] ? html`<span class="badge ok">recorded</span> <span class="muted">${st.licences[k]}</span>` : html`<span class="badge warn">not recorded</span>`}</td></tr>`;
    return html`
      <div class="head"><div><h1>Overview</h1><p class="muted small">As of ${when(o.at)} · days and months are UTC</p></div></div>
      ${licenceBanner(st.licensed_for_others)}
      ${st.maintenance ? html`<div class="banner bad"><b>Maintenance mode is on.</b> Only the owner can use the app. Switch it off under <a href="#flags">Flags</a>.</div>` : ""}
      ${o.claude.stub ? html`<div class="banner info">Claude runs in <b>stub mode</b> on this server (no API key), so Claude costs stay at zero.</div>` : ""}
      <div class="tiles">
        ${tile("Users", int(o.users.total), `${int(o.users.active7)} active in 7 days · ${int(o.users.active30)} in 30`, "#users")}
        ${tile("Claude today", usd(o.claude.today.cost_usd), cap ? `${int(o.claude.today.calls)} calls · ${pct(o.claude.today.cost_usd / cap)} of the ${usd2(cap)} daily cap` : `${int(o.claude.today.calls)} calls · no daily cap`, "#usage", meter(o.claude.today.cost_usd, cap))}
        ${tile("Claude this month", usd(o.claude.month.cost_usd), `${int(o.claude.month.calls)} calls · ${int(o.claude.month.cached)} from cache`, "#usage")}
        ${tile("FMP calls today", int(o.fmp.calls), `cache hit rate ${pct(o.fmp.hit_rate)}${o.fmp.errors ? ` · ${o.fmp.errors} errors` : ""}`, "#cache")}
        ${tile("SEC calls today", int(o.sec.calls), `cache hit rate ${pct(o.sec.hit_rate)}${o.sec.errors ? ` · ${o.sec.errors} errors` : ""}`)}
        ${tile("Open data-quality flags", int(o.dq_open), o.dq_open ? "waiting for review" : "nothing to review", "#dq")}
        ${tile("Errors, last 24 h", int(o.errors_24h), o.errors_by_source.length ? o.errors_by_source.map((x) => x.source + " " + x.n).join(" · ") : "none", "#logs/errors")}
        ${tile("Revenue this month", o.revenue_month.length ? o.revenue_month.map((x) => money(x.amount, x.currency)).join(" · ") : DASH, o.revenue_month.length ? `${o.revenue_month.reduce((s, x) => s + x.invoices, 0)} paid invoices` : "no paid invoices")}
        ${tile("MRR (estimate)", moneyMap(o.mrr.by_currency), `${int(o.mrr.paying)} paying · ${int(o.mrr.trialing)} trialing${o.mrr.livemode ? "" : " · test mode"}`, "#plans")}
      </div>
      <div class="cards">
        <div class="card"><h2>Access</h2><table class="kv">
          ${lic("fmp_display", "FMP display licence")}
          ${lic("edgar_tools_display", "Edgar Tools display licence")}
          ${lic("legal", "Legal review")}
          <tr><th>Who can sign in</th><td>${st.licensed_for_others ? (st.signups.open ? "Anyone (sign-ups open)" : "The owner and invited people") : "The owner only"}</td></tr>
          <tr><th>Invites not yet used</th><td>${int(st.allowlist_pending)} · <a href="#allowlist">allowlist</a></td></tr>
        </table></div>
        <div class="card"><h2>Billing</h2><table class="kv">
          <tr><th>Billing</th><td>${st.billing.enabled ? html`<span class="badge ok">on</span> ${st.billing.live ? html`<span class="badge acc">live</span>` : html`<span class="badge">test mode</span>`}` : html`<span class="badge">off</span>`}</td></tr>
          <tr><th>Paying subscriptions</th><td>${int(o.mrr.paying)}</td></tr>
          <tr><th>MRR by plan</th><td>${o.mrr.by_plan.length ? o.mrr.by_plan.map((x) => html`<div>${x.plan_id || "?"}: ${money(x.mrr, x.currency)} <span class="muted">(${x.count})</span></div>`) : DASH}</td></tr>
          <tr><th>Users</th><td>${int(o.users.admins)} owner/admins · ${int(o.users.disabled)} suspended · ${int(o.users.new30)} new in 30 days</td></tr>
        </table><p class="hint">Change these in <a href="#settings">Settings</a>.</p></div>
      </div>`;
  };

  // ---------- users ----------
  VIEWS.users = async ({ parts, on }) => (parts[0] ? userDetail(parts[0], on) : userList(on));

  async function userList(on) {
    const Q = S.usersQuery;
    const qs = new URLSearchParams({ limit: "50", offset: String(Q.offset) });
    if (Q.q) qs.set("q", Q.q); if (Q.role) qs.set("role", Q.role); if (Q.status) qs.set("status", Q.status);
    const r = await api("GET", A + "/users?" + qs);
    on.submit.search = (f, d) => { Object.assign(Q, { q: d.q.trim(), role: d.role, status: d.status, offset: 0 }); rerender(); };
    on.click.page = (el) => { Q.offset = Math.max(0, Q.offset + Number(el.dataset.d)); rerender(); };
    const opt = (v, cur, label) => html`<option value="${v}"${raw(v === cur ? " selected" : "")}>${label}</option>`;
    const rows = r.users.map((u) => html`<tr>
      <td class="break"><a href="#users/${u.id}">${u.email}</a></td>
      <td>${roleBadge(u.role)}</td><td>${statusBadge(u.status)}</td>
      <td class="nowrap">${u.plan.name} <span class="muted small">${u.plan.source}</span></td>
      <td>${timeCell(u.last_seen_at, true)}</td>
      <td class="num">${limitText(u.used.companies, u.limits.companies)}</td>
      <td class="num">${usd(u.used.claude_usd)}${u.limits.claude_hard_usd ? html` <span class="muted">/ ${usd2(u.limits.claude_hard_usd)}</span>` : ""}</td>
      <td class="num">${limitText(u.saved_models, u.limits.saved_models)}</td>
    </tr>`);
    return html`
      <div class="head"><div><h1>Users</h1><p class="muted small">${int(r.total)} account${r.total === 1 ? "" : "s"}. Usage is for each person's current period. Document contents are never shown here.</p></div></div>
      <form class="card row" data-form="search">
        <label class="grow">Email contains<input name="q" type="search" value="${Q.q}" placeholder="name@example.com" autocomplete="off"></label>
        <label>Role<select name="role">${opt("", Q.role, "Any")}${opt("owner", Q.role, "Owner")}${opt("admin", Q.role, "Admin")}${opt("user", Q.role, "User")}</select></label>
        <label>Status<select name="status">${opt("", Q.status, "Any")}${opt("active", Q.status, "Active")}${opt("disabled", Q.status, "Suspended")}</select></label>
        <button class="btn primary" type="submit">Search</button>
      </form>
      <div class="card">
        ${table(["Email", "Role", "Status", "Plan", "Last seen", ["Companies", "num"], ["Claude this period", "num"], ["Saved models", "num"]], rows, "No accounts match.")}
        ${r.total > r.limit ? html`<div class="row" style="justify-content:space-between;margin-top:10px">
          <span class="small muted">${int(r.offset + 1)}–${int(Math.min(r.total, r.offset + r.limit))} of ${int(r.total)}</span>
          <span class="seg"><button class="btn small" type="button" data-act="page" data-d="-50"${raw(r.offset ? "" : " disabled")}>Previous</button><button class="btn small" type="button" data-act="page" data-d="50"${raw(r.offset + r.limit < r.total ? "" : " disabled")}>Next</button></span>
        </div>` : ""}
      </div>`;
  }

  async function userDetail(id, on) {
    const [d, plans] = await Promise.all([api("GET", A + "/users/" + encodeURIComponent(id)), loadPlans()]);
    const u = d.user, L = u.limits, used = u.used, me = S.admin, isOwnerTarget = u.role === "owner", self = u.id === me.id;
    const path = A + "/users/" + encodeURIComponent(u.id);
    on.submit.role = async (f, v) => { await api("POST", path, { role: v.role }); toast("Role changed to " + v.role + "."); rerender(); };
    on.click.suspend = async () => {
      if (!confirmed(`Suspend ${u.email}? They'll be signed out everywhere and can't sign in until reactivated.`)) return;
      const r = await api("POST", path, { status: "disabled" }); toast(`Suspended. ${r.sessions_ended} session${r.sessions_ended === 1 ? "" : "s"} ended.`); rerender();
    };
    on.click.reactivate = async () => { await api("POST", path, { status: "active" }); toast("Reactivated."); rerender(); };
    on.click.signout = async () => {
      if (!confirmed(`Sign ${u.email} out of every session?`)) return;
      const r = await api("POST", path + "/signout", {}); toast(`${r.sessions_ended} session${r.sessions_ended === 1 ? "" : "s"} ended.`);
      if (self) location.href = "/"; else rerender();
    };
    on.submit.comp = async (f, v) => {
      await api("POST", path + "/comp", { plan_id: v.plan_id, until: v.until || undefined, note: v.note || undefined });
      toast("Comp granted."); rerender();
    };
    on.click.endcomp = async () => { if (!confirmed("End the active comp now?")) return; await api("DELETE", path + "/comp", {}); toast("Comp ended."); rerender(); };

    const lim = (label, k, v) => html`<tr><th>${label}</th><td class="num">${limitText(v, L[k])}</td></tr>`;
    const canStatus = !isOwnerTarget && !self && (u.role !== "admin" || isOwner());
    const activeComp = d.comps.find((c) => c.active);
    const histRows = d.history.map((h) => html`<tr><td class="nowrap">${h.day}</td><td class="num">${usd(h.claude_cost_usd)}</td><td class="num">${int(h.claude_calls)}</td><td class="num">${int(h.fmp_calls)} <span class="muted">(${int(h.fmp_hits)} cached)</span></td><td class="num">${int(h.sec_calls)}</td><td class="num">${int(h.exports)}</td><td class="num">${int(h.tickers)}</td></tr>`);
    return html`
      <p class="small"><a href="#users">← Users</a></p>
      <div class="head"><div><h1 class="break">${u.email}</h1>
        <p>${roleBadge(u.role)} ${statusBadge(u.status)} ${u.mfa ? html`<span class="badge ok">authenticator on</span>` : ""} <span class="muted small">joined ${day(u.created_at)} · last seen ${ago(u.last_seen_at)}</span></p></div></div>
      ${u.status === "disabled" ? html`<div class="banner bad">This account is suspended: it can't sign in, and its sessions were ended.</div>` : ""}
      <div class="cards">
        <div class="card"><h2>Account</h2>
          <table class="kv">
            <tr><th>Active sessions</th><td>${int(d.sessions.n)}${d.sessions.n ? html` <span class="muted small">· last used ${ago(d.sessions.last_seen_at)}</span>` : ""}</td></tr>
            <tr><th>Invite</th><td>${d.allowlist ? html`${d.allowlist.role} · invited ${day(d.allowlist.invited_at)}${d.allowlist.note ? html` · <span class="muted">${d.allowlist.note}</span>` : ""}` : html`<span class="muted">not on the allowlist</span>`}</td></tr>
            <tr><th>Language</th><td>${u.locale || DASH}</td></tr>
            <tr><th>Saved documents</th><td>${d.docs.length ? d.docs.map((x) => html`<div>${x.kind}: ${int(x.n)} <span class="muted small">(${bytes(x.bytes)})</span></div>`) : DASH}</td></tr>
          </table>
          <h3>Role</h3>
          <form class="row" data-form="role">
            <select name="role"${ownerAttr(isOwnerTarget ? "The owner's role is fixed" : "")}>${(isOwnerTarget ? ["owner"] : ["user", "admin"]).map((r) => html`<option${raw(r === u.role ? " selected" : "")}>${r}</option>`)}</select>
            <button class="btn" type="submit"${ownerAttr(isOwnerTarget ? "The owner's role is fixed" : "")}>Change role</button>
          </form>
          <h3>Access</h3>
          <div class="row">
            ${u.status === "active"
              ? html`<button class="btn danger" type="button" data-act="suspend"${raw(canStatus ? "" : ` disabled title="${esc(isOwnerTarget ? "The owner can't be suspended" : self ? "You can't suspend yourself" : OWNER_ONLY)}"`)}>Suspend</button>`
              : html`<button class="btn" type="button" data-act="reactivate"${raw(canStatus ? "" : ` disabled title="${OWNER_ONLY}"`)}>Reactivate</button>`}
            <button class="btn" type="button" data-act="signout"${raw(d.sessions.n && (!isOwnerTarget || isOwner()) ? "" : " disabled")}>Sign out everywhere</button>
          </div>
        </div>
        <div class="card"><h2>Plan and usage</h2>
          <table class="kv">
            <tr><th>Plan</th><td>${u.plan_name} <span class="muted small">(${u.plan.source})</span></td></tr>
            <tr><th>Period</th><td>${day(u.period.start)} to ${day(u.period.end)}</td></tr>
            ${lim("Companies", "companies", used.companies)}${lim("Saved models", "saved_models", u.saved_models)}${lim("Notes drafts", "drafts", used.drafts)}
            ${lim("Translations", "translations", used.translations)}${lim("Guidance reads", "guidance", used.guidance)}${lim("Segment fills", "segment_fills", used.segment_fills)}${lim("Downloads", "exports", used.exports)}
            <tr><th>Claude (metered)</th><td class="num">${usd(used.claude_usd)} <span class="muted">/ ${L.claude_hard_usd === null || L.claude_hard_usd === undefined ? "no cap" : usd2(L.claude_hard_usd)}</span></td></tr>
            <tr><th>Claude (from events)</th><td class="num">${usd(d.claude_period.cost_usd)} <span class="muted">· ${int(d.claude_period.calls)} calls</span></td></tr>
          </table>
          ${d.by_site.length ? html`<h3>Claude by prompt site, this period</h3>${table(["Site", ["Calls", "num"], ["Cost", "num"]], d.by_site.map((s) => html`<tr><td>${s.site}</td><td class="num">${int(s.calls)}</td><td class="num">${usd(s.cost_usd)}</td></tr>`))}` : ""}
        </div>
      </div>
      <div class="card"><h2>Comps</h2>
        <p class="muted small">A comp puts this person on a plan for free, ahead of any subscription. ${isOwnerTarget ? "The owner's plan is fixed." : ""}</p>
        ${table(["Plan", "Until", "Note", "Granted by", "Granted", "State"], d.comps.map((c) => html`<tr><td>${c.plan_name || c.plan_id}</td><td class="nowrap">${c.until ? day(c.until) : "open-ended"}</td><td class="break">${c.note || ""}</td><td class="break">${c.granted_by || DASH}</td><td>${timeCell(c.created_at)}</td><td>${c.active ? html`<span class="badge ok">active</span>` : html`<span class="badge">ended</span>`}</td></tr>`), "No comps.")}
        ${isOwnerTarget ? "" : html`
          <form class="row" data-form="comp" style="margin-top:12px">
            <label>Plan<select name="plan_id" required>${plans.plans.filter((p) => p.id !== "owner").map((p) => html`<option value="${p.id}"${raw(p.id === "comp" ? " selected" : "")}>${p.name}${p.active ? "" : " (inactive)"}</option>`)}</select></label>
            <label>Until (UTC, inclusive)<input type="date" name="until"></label>
            <label class="grow">Note<input name="note" maxlength="500" placeholder="Why (optional)"></label>
            <button class="btn primary" type="submit">Grant comp</button>
            ${activeComp ? html`<button class="btn danger" type="button" data-act="endcomp">End active comp</button>` : ""}
          </form>`}
      </div>
      ${d.subscriptions.length || d.invoices.length ? html`<div class="card"><h2>Billing</h2>
        ${d.subscriptions.length ? html`<h3>Subscriptions</h3>${table(["Status", "Plan", "Price", "Period", "Mode", "Synced"], d.subscriptions.map((s) => html`<tr><td><span class="badge ${s.status === "active" ? "ok" : s.status === "past_due" ? "warn" : ""}">${s.status}</span>${s.cancel_at_period_end ? html` <span class="badge warn">cancels</span>` : ""}</td><td>${s.plan_id || DASH}</td><td class="num">${s.unit_amount !== null ? money(s.unit_amount, s.currency) + " / " + (s.interval || "?") : DASH}</td><td class="nowrap">${day(s.current_period_start)} – ${day(s.current_period_end)}</td><td>${s.livemode ? "live" : "test"}</td><td>${timeCell(s.synced_at, true)}</td></tr>`))}` : ""}
        ${d.invoices.length ? html`<h3>Invoices</h3>${table(["Date", "Status", ["Paid", "num"], ["Due", "num"], ""], d.invoices.map((x) => html`<tr><td>${timeCell(x.created_at)}</td><td>${x.status}</td><td class="num">${money(x.amount_paid, x.currency)}</td><td class="num">${money(x.amount_due, x.currency)}</td><td>${/^https:\/\//.test(x.hosted_invoice_url || "") ? html`<a href="${x.hosted_invoice_url}" target="_blank" rel="noopener noreferrer">invoice</a>` : ""}</td></tr>`))}` : ""}
      </div>` : ""}
      <div class="card"><h2>Usage by day <span class="muted small">(last 30 days, UTC)</span></h2>
        ${table(["Day", ["Claude", "num"], ["Claude calls", "num"], ["FMP calls", "num"], ["SEC calls", "num"], ["Downloads", "num"], ["Tickers", "num"]], histRows, "No usage in the last 30 days.")}
      </div>
      <div class="card"><h2>Recent activity</h2>
        ${table(["When", "Action", "Target", "By"], d.activity.map((a) => html`<tr><td>${timeCell(a.at)}</td><td class="mono small">${a.action}</td><td class="break">${a.target || ""}</td><td class="break">${a.actor || DASH}</td></tr>`), "No activity recorded.")}
      </div>`;
  }

  // ---------- allowlist ----------
  VIEWS.allowlist = async ({ on }) => {
    const r = await api("GET", A + "/allowlist");
    on.submit.add = async (f, v) => {
      const res = await api("POST", A + "/allowlist", { email: v.email, role: v.role, note: v.note });
      toast(res.warning || `${res.email} can now sign in as ${res.role}.`); rerender();
    };
    on.click.remove = async (el) => {
      const email = el.dataset.email;
      if (!confirmed(`Remove ${email} from the allowlist?`)) return;
      const res = await api("DELETE", A + "/allowlist/" + encodeURIComponent(email), {});
      toast(res.account && res.account.status === "active" ? `Removed. ${email} already has an account and can still sign in; suspend it under Users to block access.` : "Removed.");
      rerender();
    };
    const account = (x) => {
      if (!x.user_id) return html`<span class="muted">no account yet</span>${!r.licensed && x.role !== "owner" ? html` <span class="badge warn">can't sign in yet</span>` : ""}`;
      return html`<a href="#users/${x.user_id}">${statusBadge(x.account_status)}</a> <span class="muted small">${x.account_role}</span>`;
    };
    const rows = r.rows.map((x) => html`<tr>
      <td class="break">${x.email}</td><td>${roleBadge(x.role)}</td><td>${account(x)}</td><td>${timeCell(x.last_seen_at, true)}</td>
      <td class="break">${x.invited_by || DASH}</td><td>${timeCell(x.invited_at)}</td><td class="break small">${x.note || ""}</td>
      <td class="actions">${x.role === "owner" ? "" : html`<button class="btn small danger" type="button" data-act="remove" data-email="${x.email}"${raw(x.role === "admin" && !isOwner() ? ` disabled title="${OWNER_ONLY}"` : "")}>Remove</button>`}</td>
    </tr>`);
    return html`
      <div class="head"><div><h1>Allowlist</h1><p class="muted small">Who may create an account. The role here applies when the account is first created; change an existing account's role under Users.</p></div></div>
      ${licenceBanner(r.licensed)}
      ${r.licensed && r.signups.open ? html`<div class="banner info">Sign-ups are open: anyone can create an account, not only the people listed here.</div>` : ""}
      <form class="card row" data-form="add">
        <label class="grow">Email<input name="email" type="email" required placeholder="name@example.com" autocomplete="off"></label>
        <label>Role<select name="role"><option value="user">user</option><option value="admin"${raw(isOwner() ? "" : ` disabled title="${OWNER_ONLY}"`)}>admin${isOwner() ? "" : " (owner only)"}</option></select></label>
        <label class="grow">Note<input name="note" maxlength="500" placeholder="Who they are (optional)"></label>
        <button class="btn primary" type="submit">Add</button>
      </form>
      <div class="card">
        ${table(["Email", "Role", "Account", "Last seen", "Invited by", "Invited", "Note", ""], rows, "Nobody is on the allowlist.")}
        <p class="hint">Removing someone stops a new account being created. An existing account keeps signing in until it's suspended under Users.</p>
      </div>`;
  };

  // ---------- usage and cost ----------
  VIEWS.usage = async ({ query, charts: slots }) => {
    const days = [7, 30, 90].includes(+query.get("days")) ? +query.get("days") : 30;
    const r = await api("GET", A + "/usage?days=" + days);
    const t = r.totals;
    const cost = chartSlot(slots, "chart-cost", "Claude cost per day (US$)", null, r.daily.map((d) => ({ label: d.day, v: d.claude_cost_usd, note: d.claude_calls + " calls" })), { value: usd, axis: (v, dec) => "$" + v.toFixed(dec) });
    const fmp = chartSlot(slots, "chart-fmp", "FMP calls per day", "Every request, cached or not", r.daily.map((d) => ({ label: d.day, v: d.fmp_calls, note: d.fmp_hits + " from cache" })), { value: (v) => int(v) + " calls", axis: (v) => int(v) });
    const siteList = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + " " + v).join(" · ");
    const days_ = r.daily.slice().reverse().map((d) => html`<tr><td class="nowrap">${d.day}</td><td class="num">${usd(d.claude_cost_usd)}</td><td class="num">${int(d.claude_calls)}</td><td class="num">${int(d.claude_cached)}</td>
      <td class="small">${siteList(d.claude_sites) || ""}</td><td class="num">${int(d.fmp_calls)}</td><td class="num">${d.fmp_calls ? pct(d.fmp_hits / d.fmp_calls) : DASH}</td><td class="num">${int(d.sec_calls)}</td><td class="num">${int(d.exports)}</td><td class="num">${int(d.active_users)}</td></tr>`);
    const spenders = r.spenders.map((s) => html`<tr><td class="break">${s.email ? html`<a href="#users/${s.user_id}">${s.email}</a>` : s.user_id}</td><td>${s.plan ? s.plan.name : DASH}</td>
      <td class="num">${usd(s.claude_cost_usd)}</td><td class="num">${int(s.claude_calls)}</td><td class="num">${int(s.fmp_calls)}</td><td class="num">${int(s.sec_calls)}</td><td class="num">${int(s.exports)}</td><td class="num">${int(s.tickers)}</td><td class="num">${moneyMap(s.paid)}</td></tr>`);
    const sites = r.sites.map((s) => html`<tr><td><a href="#prompts/${s.site}">${s.site}</a>${s.stub ? html` <span class="badge">stub ${int(s.stub)}</span>` : ""}</td><td class="num">${int(s.calls)}</td><td class="num">${int(s.cached)}</td><td class="num">${usd(s.cost_usd)}</td>
      <td class="num">${s.calls ? usd(s.cost_usd / s.calls) : DASH}</td><td class="num">${int(s.avg_input_tokens)}</td><td class="num">${int(s.avg_output_tokens)}</td><td class="num">${s.problems ? html`<span class="badge warn">${int(s.problems)}</span>` : "0"}</td></tr>`);
    return html`
      <div class="head"><div><h1>Usage and cost</h1><p class="muted small">Since ${day(r.from)} (UTC). Claude cost is what the API calls cost at list prices.</p></div>
        <div class="row"><span class="seg">${[7, 30, 90].map((n) => html`<a class="btn small ${n === days ? "on" : ""}" href="#usage?days=${n}">${n} days</a>`)}</span>
        <a class="btn small" href="${A}/usage/export.csv?days=${days}" download>Download CSV</a></div></div>
      <div class="tiles">
        ${tile("Claude cost", usd(t.claude_cost_usd), `${int(t.claude_calls)} calls · ${int(t.claude_cached)} from cache${t.claude_stub ? ` · ${int(t.claude_stub)} stub` : ""}`)}
        ${tile("Average per day", usd(t.claude_cost_usd / r.days), "Claude")}
        ${tile("FMP calls", int(t.fmp_calls), `cache hit rate ${t.fmp_calls ? pct(t.fmp_hits / t.fmp_calls) : DASH}${t.fmp_errors ? ` · ${int(t.fmp_errors)} errors` : ""}`)}
        ${tile("SEC calls", int(t.sec_calls), `${int(t.sec_hits)} from cache`)}
        ${tile("Downloads", int(t.exports), "Excel and PDF")}
      </div>
      <div class="cards"><div class="card">${cost}</div><div class="card">${fmp}</div></div>
      <div class="card"><h2>Top users by cost</h2>${table(["User", "Plan", ["Claude", "num"], ["Claude calls", "num"], ["FMP calls", "num"], ["SEC", "num"], ["Downloads", "num"], ["Tickers", "num"], ["Paid", "num"]], spenders, "No usage in this window.")}
        <p class="hint">FMP calls here exclude cache hits (those cost nothing upstream). Paid is invoices paid in the same window.</p></div>
      <div class="card"><h2>By prompt site</h2>${table(["Site", ["Calls", "num"], ["Cached", "num"], ["Cost", "num"], ["Per call", "num"], ["Avg input tok", "num"], ["Avg output tok", "num"], ["Refused / cut", "num"]], sites, "No Claude calls in this window.")}</div>
      <div class="card"><h2>By day</h2>${table(["Day", ["Claude", "num"], ["Calls", "num"], ["Cached", "num"], "By site", ["FMP", "num"], ["FMP hits", "num"], ["SEC", "num"], ["Downloads", "num"], ["Users", "num"]], days_)}</div>`;
  };

  // ---------- cache ----------
  VIEWS.cache = async ({ on }) => {
    const r = await api("GET", A + "/cache");
    const purge = async (body, what) => {
      if (!confirmed(`Delete ${what} from the FMP cache? The next request for it goes to FMP again.`)) return;
      const res = await api("POST", A + "/cache/purge", body); toast(`${int(res.deleted)} entr${res.deleted === 1 ? "y" : "ies"} deleted.`); rerender();
    };
    on.click.purgePath = (el) => purge({ path: el.dataset.path }, "every “" + el.dataset.path + "” entry");
    on.click.purgeTicker = (el) => purge({ ticker: el.dataset.ticker }, "every " + el.dataset.ticker + " entry");
    on.click.purgeAll = () => purge({ all: true }, "everything");
    on.submit.purgeTicker = (f, v) => purge({ ticker: v.ticker.trim().toUpperCase() }, "every " + v.ticker.trim().toUpperCase() + " entry");
    on.click.purgeClaude = async (el) => {
      const site = el.dataset.site || "";
      if (!confirmed(site ? `Delete the cached Claude answers for ${site}?` : "Delete every cached Claude answer?")) return;
      const res = await api("POST", A + "/cache/purge-claude", site ? { site } : {}); toast(`${int(res.deleted)} cached answer${res.deleted === 1 ? "" : "s"} deleted.`); rerender();
    };
    const T = r.fmp.total;
    const rowOf = (k, x, act) => html`<tr><td class="mono">${k}</td><td class="num">${int(x.count)}</td><td class="num">${bytes(x.bytes)}</td><td class="num">${int(x.hits)}</td><td>${timeCell(x.oldest, true)}</td><td class="num">${int(x.expired)}</td><td class="actions">${act}</td></tr>`;
    return html`
      <div class="head"><div><h1>Cache</h1><p class="muted small">FMP responses are cached on the server, shared by every user; Claude's JSON answers are cached per prompt version.</p></div></div>
      <div class="tiles">
        ${tile("FMP entries", int(T.count), `${int(T.tickers)} tickers · ${int(T.expired)} expired`)}
        ${tile("FMP cache size", bytes(T.bytes), `newest ${ago(T.newest)}`)}
        ${tile("FMP cache hits", int(T.hits), "served without calling FMP")}
        ${tile("Claude answers", int(r.claude.reduce((s, x) => s + x.count, 0)), bytes(r.claude.reduce((s, x) => s + x.bytes, 0)))}
      </div>
      <form class="card row" data-form="purgeTicker">
        <label>Purge one ticker<input name="ticker" required maxlength="12" placeholder="NKE" autocapitalize="characters" autocomplete="off"></label>
        <button class="btn" type="submit">Purge ticker</button>
        <span class="grow"></span>
        <button class="btn danger" type="button" data-act="purgeAll"${raw(T.count ? "" : " disabled")}>Purge all FMP cache</button>
      </form>
      <div class="card"><h2>FMP by endpoint</h2>${table(["Path", ["Entries", "num"], ["Size", "num"], ["Hits", "num"], "Oldest", ["Expired", "num"], ""], r.fmp.by_path.map((x) => rowOf(x.path, x, html`<button class="btn small danger" type="button" data-act="purgePath" data-path="${x.path}">Purge</button>`)), "The FMP cache is empty.")}</div>
      <div class="card"><h2>FMP by ticker <span class="muted small">(largest 200)</span></h2>${table(["Ticker", ["Entries", "num"], ["Size", "num"], ["Hits", "num"], "Oldest", ["Expired", "num"], ""], r.fmp.by_ticker.map((x) => rowOf(x.ticker || "(market-wide)", x, x.ticker ? html`<button class="btn small danger" type="button" data-act="purgeTicker" data-ticker="${x.ticker}">Purge</button>` : "")), "The FMP cache is empty.")}</div>
      <div class="card"><h2>Claude answers by site</h2>
        ${table(["Site", ["Answers", "num"], ["Size", "num"], "Oldest", ["Expired", "num"], ""], r.claude.map((x) => html`<tr><td class="mono">${x.site}</td><td class="num">${int(x.count)}</td><td class="num">${bytes(x.bytes)}</td><td>${timeCell(x.oldest, true)}</td><td class="num">${int(x.expired)}</td><td class="actions"><button class="btn small danger" type="button" data-act="purgeClaude" data-site="${x.site}">Purge</button></td></tr>`), "No cached Claude answers.")}
        ${r.claude.length ? html`<div class="row" style="margin-top:10px"><button class="btn danger" type="button" data-act="purgeClaude" data-site="">Purge all Claude answers</button></div>` : ""}
      </div>
      ${r.sec.length ? html`<div class="card"><h2>SEC cache</h2>${table(["Kind", ["Entries", "num"], ["Size", "num"], "Oldest"], r.sec.map((x) => html`<tr><td class="mono">${x.kind}</td><td class="num">${int(x.count)}</td><td class="num">${bytes(x.bytes)}</td><td>${timeCell(x.oldest, true)}</td></tr>`))}</div>` : ""}`;
  };

  // ---------- prompts ----------
  const APPLIES = (s) => (!s.applies.body ? "This site's text is built in page code, so a version sets only the model, effort and max tokens."
    : !s.applies.settings ? "Only the text applies here: a notes draft takes its model, effort and max tokens from notes.prompt."
      : "The text replaces the page's built-in prompt; the model, effort and max tokens apply to this site's calls.");
  const v1Cache = new Map();
  async function version(site, id) { return api("GET", A + "/prompts/" + encodeURIComponent(site) + "/versions/" + id); }

  VIEWS.prompts = async ({ parts, on }) => {
    const r = await api("GET", A + "/prompts");
    if (!parts[0]) {
      const rows = r.sites.map((s) => {
        const a = s.versions.find((v) => v.active);
        return html`<tr><td><a class="mono" href="#prompts/${s.site}">${s.site}</a></td><td class="small">${s.description}</td><td>${s.json_site ? html`<span class="badge">JSON</span>` : ""}</td>
          <td class="nowrap">${a ? html`v${a.version}` : DASH}</td><td class="mono small">${a ? a.model : ""}</td><td>${a ? a.effort : ""}</td><td class="num">${a ? int(a.max_tokens) : ""}</td><td class="num">${int(s.versions.length)}</td></tr>`;
      });
      return html`<div class="head"><div><h1>Prompts</h1><p class="muted small">Version 1 of each site is the prompt as written in the page. New versions take effect for everyone once the owner activates them.</p></div></div>
        <div class="card">${table(["Site", "What it does", "", "Active", "Model", "Effort", ["Max tokens", "num"], ["Versions", "num"]], rows)}</div>`;
    }
    const s = r.sites.find((x) => x.site === parts[0]);
    if (!s) return html`<div class="banner bad">No prompt site called ${parts[0]}.</div>`;
    const active = s.versions.find((v) => v.active);
    const v1 = s.versions.find((v) => v.version === 1);
    const viewId = parts[1] ? +parts[1] : null;
    const [viewed, base, activeFull] = await Promise.all([
      viewId ? version(s.site, viewId) : null,
      v1 && s.applies.body ? (v1Cache.get(v1.id) || version(s.site, v1.id).then((x) => { v1Cache.set(v1.id, x); return x; })) : null,
      active && s.applies.body ? version(s.site, active.id) : null,
    ]);
    const mode = new URLSearchParams(location.hash.split("?")[1] || "").get("show") || "diff";
    on.click.activate = async (el) => {
      if (!confirmed(`Make version ${el.dataset.v} the live prompt for ${s.site}? It applies to every user's next request.`)) return;
      await api("POST", A + "/prompts/" + encodeURIComponent(s.site) + "/activate", { version_id: +el.dataset.id });
      toast(`Version ${el.dataset.v} is now live for ${s.site}.`); rerender();
    };
    on.click.useBase = async (el) => {
      const v = await version(s.site, +el.dataset.id);
      const f = main.querySelector('form[data-form="create"]');
      if (f.body) f.body.value = v.body;
      f.model.value = v.model; f.effort.value = v.effort || "low"; f.max_tokens.value = v.max_tokens;
      checkJson(f.body);
      f.scrollIntoView({ behavior: "smooth", block: "start" });
      toast(`Form filled from version ${v.version}.`);
    };
    const checkJson = (ta) => {
      const w = main.querySelector("#json-warn");
      if (w && ta) w.hidden = !(s.json_site && !/\bjson\b/i.test(ta.value));
    };
    on.input.body = (ta) => checkJson(ta);
    on.submit.create = async (f, v) => {
      if (s.json_site && s.applies.body && !/\bjson\b/i.test(v.body || "") && !confirmed("This site's answer is read as JSON, but the prompt doesn't mention JSON any more. The feature will likely break. Save anyway?")) return;
      const res = await api("POST", A + "/prompts/" + encodeURIComponent(s.site) + "/versions", { body: v.body || "", model: v.model, effort: v.effort, max_tokens: +v.max_tokens, note: v.note || undefined });
      toast(`Saved as version ${res.version}.${res.warnings.length ? " " + res.warnings.join(" ") : ""}${isOwner() ? " Activate it to make it live." : " The owner can activate it."}`, res.warnings.length ? "bad" : "");
      go(`#prompts/${s.site}/${res.id}`);
    };
    const vrows = s.versions.map((v) => html`<tr${raw(v.id === viewId ? ' class="sel"' : "")}>
      <td class="nowrap"><a href="#prompts/${s.site}/${v.id}">v${v.version}</a> ${v.active ? html`<span class="badge ok">live</span>` : ""}</td>
      <td class="mono small nowrap">${v.model}</td><td>${v.effort || DASH}</td><td class="num">${int(v.max_tokens)}</td><td class="num">${int(v.chars)}</td>
      <td class="break small">${v.note || ""}</td><td class="small nowrap">${v.created_by || DASH}</td><td>${timeCell(v.created_at)}</td>
      <td class="actions"><button class="btn small" type="button" data-act="useBase" data-id="${v.id}">Edit a copy</button>
        ${v.active ? "" : html` <button class="btn small" type="button" data-act="activate" data-id="${v.id}" data-v="${v.version}"${ownerAttr()}>Activate</button>`}</td></tr>`);
    const start = activeFull || active || { model: r.models[0] && r.models[0].model, effort: "low", max_tokens: 16000, body: "" };
    const viewer = viewed ? html`<div class="card" id="viewer">
        <div class="head"><div><h2>Version ${viewed.version} ${viewed.active ? html`<span class="badge ok">live</span>` : ""}</h2>
          <p class="small muted"><span class="mono">${viewed.model}</span> · effort ${viewed.effort || DASH} · max ${int(viewed.max_tokens)} tokens · by ${viewed.created_by || DASH} · ${when(viewed.created_at)}${viewed.note ? " · " + viewed.note : ""}</p></div>
          ${s.applies.body ? html`<span class="seg"><a class="btn small ${mode === "diff" ? "on" : ""}" href="#prompts/${s.site}/${viewed.id}?show=diff">Changes vs v1</a><a class="btn small ${mode === "text" ? "on" : ""}" href="#prompts/${s.site}/${viewed.id}?show=text">Full text</a></span>` : ""}</div>
        ${!s.applies.body ? html`<p class="muted">No text for this site; the version holds settings only.</p>`
          : mode === "text" || !base ? html`<pre class="body">${viewed.body}</pre>` : diffView(base.body, viewed.body)}
      </div>` : "";
    return html`
      <p class="small"><a href="#prompts">← Prompts</a></p>
      <div class="head"><div><h1 class="mono">${s.site}</h1><p class="muted">${s.description}</p></div></div>
      <div class="banner info">${APPLIES(s)}${s.json_site ? " This site's answer is parsed as JSON: a new version must keep asking for JSON in the same shape." : ""}</div>
      <div class="card"><h2>Versions</h2>${table(["Version", "Model", "Effort", ["Max tokens", "num"], ["Chars", "num"], "Note", "By", "Created", ""], vrows)}
        ${isOwner() ? "" : html`<p class="hint">Only the owner can activate a version.</p>`}</div>
      ${viewer}
      <form class="card stack" data-form="create">
        <h2>New version</h2>
        <p class="small muted">Starts from the live version. Saving creates version ${int((s.versions[0] ? s.versions[0].version : 0) + 1)}; nothing changes for users until it's activated.</p>
        ${s.applies.body ? html`<label class="field">Prompt text<textarea name="body" data-input="body" spellcheck="false" required>${start.body || ""}</textarea></label>
          <p class="warntext" id="json-warn" hidden>This site's answer is parsed as JSON, and this text no longer mentions JSON.</p>` : ""}
        <div class="row">
          <label>Model<select name="model">${r.models.map((m) => html`<option value="${m.model}"${raw(m.model === start.model ? " selected" : "")}>${m.model} ($${m.input_per_mtok}/$${m.output_per_mtok} per Mtok)</option>`)}</select></label>
          <label>Effort<select name="effort">${r.efforts.map((e) => html`<option${raw(e === start.effort ? " selected" : "")}>${e}</option>`)}</select></label>
          <label>Max tokens<input name="max_tokens" type="number" min="${r.max_tokens.min}" max="${r.max_tokens.max}" step="1000" value="${start.max_tokens}" required></label>
          <label class="grow">Note<input name="note" maxlength="500" placeholder="What changed and why"></label>
          <button class="btn primary" type="submit">Save version</button>
        </div>
      </form>`;
  };

  // ---------- feature flags ----------
  VIEWS.flags = async ({ on }) => {
    const r = await api("GET", A + "/flags");
    on.change.flag = async (el) => {
      const key = el.dataset.key, enabled = el.checked;
      if (key === "maintenance" && enabled && !confirmed("Turn on maintenance mode? Everyone but the owner loses access until it's turned off.")) { el.checked = false; return; }
      try { await api("POST", A + "/flags/" + encodeURIComponent(key), { enabled }); toast(`${key} is now ${enabled ? "on" : "off"}.`); }
      catch (e) { el.checked = !enabled; throw e; }
      if (key === "maintenance") rerender();
    };
    const rows = r.flags.map((f) => html`<tr>
      <td><label class="switch"><input type="checkbox" data-change="flag" data-key="${f.key}" aria-label="${f.key}"${raw(f.enabled ? " checked" : "")}${raw(f.owner_only && !isOwner() ? ` disabled title="${OWNER_ONLY}"` : "")}><i></i></label></td>
      <td class="mono">${f.key}${f.owner_only ? html` <span class="badge">owner</span>` : ""}</td><td>${f.description}</td><td class="num">${f.user_overrides ? int(f.user_overrides) : ""}</td></tr>`);
    const maint = r.flags.find((f) => f.key === "maintenance");
    return html`<div class="head"><div><h1>Feature flags</h1><p class="muted small">Switches take effect on the next request. Turning a Claude feature off shows it as unavailable in the app.</p></div></div>
      ${maint && maint.enabled ? html`<div class="banner bad"><b>Maintenance mode is on.</b> Only the owner can use the app.</div>` : ""}
      <div class="card">${table(["On", "Flag", "What it does", ["Per-user overrides", "num"]], rows)}</div>`;
  };

  // ---------- data quality (the API is dq/index.js's; this page copes when it isn't there yet) ----------
  const DQ = A + "/dq";
  const listOf = (r, key) => (Array.isArray(r) ? r : (r && (r[key] || r.rows || r.items)) || []);
  async function soft(p) { try { return { ok: true, data: await p }; } catch (e) { return { ok: false, error: e }; } }
  const missing = (e) => e.status === 404 || e.status === 405 || e.status === 501;
  function overrideRule(o) {
    let rule = o.rule;
    if (typeof rule === "string") { try { rule = JSON.parse(rule); } catch (e) { rule = {}; } }
    return { from: o.from ?? (rule && rule.from), to: o.to ?? (rule && rule.to) };
  }

  const DQ_STATUSES = ["open", "acknowledged", "fixed", "wontfix", "all"];
  const dqLabel = (s) => (s === "wontfix" ? "won't fix" : s);
  // FMP and SEC values are stored as text; show numbers with separators
  const dqValue = (v) => (v === null || v === undefined || v === "" ? "" : isFinite(+v) ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 4 }) : v);
  function dqDetail(d) {
    if (!d) return "";
    if (typeof d !== "object") return d;
    const bits = [d.form, d.filed && "filed " + d.filed, d.accession].filter(Boolean).join(" · ");
    return html`${d.label ? html`<div>${d.label}</div>` : ""}${d.diff_pct !== undefined && d.diff_pct !== null ? html`<span class="badge warn">${(d.diff_pct > 0 ? "+" : "") + d.diff_pct}%</span> ` : ""}${bits ? html`<span class="muted">${bits}</span>` : ""}${jsonBlock(d, "details")}`;
  }

  VIEWS.dq = async ({ query, on }) => {
    const status = DQ_STATUSES.includes(query.get("status")) ? query.get("status") : "open";
    const before = /^\d+$/.test(query.get("before") || "") ? query.get("before") : "";
    const [flags, overrides, summary] = await Promise.all([
      soft(api("GET", DQ + "/flags?status=" + status + (before ? "&before=" + before : ""))), soft(api("GET", DQ + "/overrides")), soft(api("GET", DQ + "/summary"))]);
    on.click.setFlag = async (el) => {
      const tr = el.closest("tr"), note = tr.querySelector("input[name=note]");
      await api("POST", DQ + "/flags/" + encodeURIComponent(el.dataset.id), { status: el.dataset.status, ...(note && note.value.trim() ? { note: note.value.trim() } : {}) });
      toast(`Flag marked ${dqLabel(el.dataset.status)}.`); rerender();
    };
    on.submit.run = async (f, v) => {
      const res = await api("POST", DQ + "/run", { ticker: v.ticker.trim().toUpperCase() });
      const parts = [`Checked ${int(res.checked)} value${res.checked === 1 ? "" : "s"}`, `${int(res.flagged)} different`, `${int(res.created)} new flag${res.created === 1 ? "" : "s"}`];
      if (res.resolved) parts.push(`${int(res.resolved)} closed`);
      toast(parts.join(", ") + "." + (res.skipped && res.skipped.length ? " " + res.skipped[0] : ""), res.skipped && res.skipped.length && !res.checked ? "bad" : "");
      rerender();
    };
    on.submit.override = async (f, v) => {
      await api("POST", DQ + "/overrides", { ticker: v.ticker.trim().toUpperCase(), kind: v.kind, from: v.from, to: v.to });
      toast("Override saved. It applies to FMP segment data for that ticker from the next load."); rerender();
    };
    on.click.offOverride = async (el) => {
      if (!confirmed("Stop applying this override?")) return;
      await api("DELETE", DQ + "/overrides/" + encodeURIComponent(el.dataset.id), {});
      toast("Override switched off."); rerender();
    };
    const notReady = html`<div class="banner info">The data-quality module isn't installed on this server yet, so there's nothing to show here.</div>`;
    const failed = (r) => (missing(r.error) ? notReady : html`<div class="banner bad">${r.error.message}</div>`);
    const counts = summary.ok && summary.data.by_status ? summary.data.by_status : null;
    let flagsCard;
    if (!flags.ok) flagsCard = failed(flags);
    else {
      const list = listOf(flags.data, "flags");
      const rows = list.map((x) => html`<tr>
        <td>${timeCell(x.at)}</td><td class="mono">${x.ticker}</td><td><span class="badge">${x.kind}</span></td><td class="small">${x.field || ""}${x.period ? html` <span class="muted">${x.period}</span>` : ""}</td>
        <td class="num small">${dqValue(x.fmp_value)}</td><td class="num small">${dqValue(x.sec_value)}</td>
        <td class="small break detail">${dqDetail(x.detail)}${x.note ? html`<div class="muted">Note: ${x.note}</div>` : ""}</td>
        <td><span class="badge ${x.status === "open" ? "warn" : x.status === "fixed" ? "ok" : ""}">${dqLabel(x.status)}</span></td>
        <td class="actions"><div class="dq-act"><input name="note" placeholder="Note (optional)" maxlength="500" aria-label="Note">
          ${["acknowledged", "fixed", "wontfix"].filter((s) => s !== x.status).map((s) => html`<button class="btn small" type="button" data-act="setFlag" data-id="${x.id}" data-status="${s}">${s === "acknowledged" ? "ack" : dqLabel(s)}</button>`)}</div></td></tr>`);
      const next = flags.data && flags.data.next;
      flagsCard = html`${table(["When", "Ticker", "Kind", "Field", ["FMP", "num"], ["SEC", "num"], "Detail", "Status", ""], rows, status === "open" ? "No open flags." : "No flags with this status.")}
        ${before || next ? html`<div class="row" style="margin-top:10px">${before ? html`<a class="btn small" href="#dq?status=${status}">Newest</a>` : ""}${next ? html`<a class="btn small" href="#dq?status=${status}&before=${next}">Older</a>` : ""}</div>` : ""}`;
    }
    let ovCard;
    if (!overrides.ok) ovCard = failed(overrides);
    else {
      const rows = listOf(overrides.data, "overrides").map((o) => {
        const r = overrideRule(o), on_ = !(o.active === 0 || o.active === false);
        return html`<tr><td class="mono">${o.ticker}</td><td>${o.kind === "geo_label" ? "geography" : o.kind === "product_label" ? "product" : o.kind}</td><td class="break">${r.from}</td><td class="break">${r.to}</td>
          <td>${on_ ? html`<span class="badge ok">active</span>` : html`<span class="badge">off</span>`}</td><td>${timeCell(o.created_at)}</td>
          <td class="actions">${on_ ? html`<button class="btn small danger" type="button" data-act="offOverride" data-id="${o.id}">Switch off</button>` : ""}</td></tr>`;
      });
      ovCard = html`${table(["Ticker", "Segments", "FMP label", "Shown as", "State", "Added", ""], rows, "No overrides.")}
        <form class="row" data-form="override" style="margin-top:12px">
          <label>Ticker<input name="ticker" required maxlength="12" placeholder="NKE" autocapitalize="characters" autocomplete="off" style="width:90px"></label>
          <label>Segments<select name="kind"><option value="geo_label">geography</option><option value="product_label">product</option></select></label>
          <label class="grow">FMP label<input name="from" required maxlength="200" placeholder="Other Americas"></label>
          <label class="grow">Show as<input name="to" required maxlength="200" placeholder="Asia Pacific & Latin America"></label>
          <button class="btn primary" type="submit">Add override</button>
        </form>`;
    }
    const last = summary.ok && summary.data.last_check;
    return html`<div class="head"><div><h1>Data quality</h1><p class="muted small">Differences between FMP and the SEC filings, and label fixes applied to FMP segment data.${last && last.at ? html` Last check: ${last.ticker || ""} ${ago(last.at)}.` : ""}</p></div></div>
      <div class="card"><div class="head"><h2>Flags</h2><span class="seg">${DQ_STATUSES.map((s) => html`<a class="btn small ${s === status ? "on" : ""}" href="#dq?status=${s}">${dqLabel(s)}${counts && s !== "all" ? " " + int(counts[s] || 0) : ""}</a>`)}</span></div>${flagsCard}</div>
      <form class="card row" data-form="run"><label>Check a ticker now<input name="ticker" required maxlength="12" placeholder="NKE" autocapitalize="characters" autocomplete="off"></label><button class="btn" type="submit"${raw(flags.ok ? "" : " disabled")}>Run check</button><span class="hint">Compares FMP's statements and segments with the SEC filings, opens flags for differences and closes ones that now agree.</span></form>
      <div class="card"><h2>Segment label overrides</h2><p class="small muted">Rename a segment label FMP reports for one ticker, so the model shows the company's own name for it.</p>${ovCard}</div>`;
  };

  // ---------- logs ----------
  VIEWS.logs = async ({ parts, query, on }) => {
    const tab = parts[0] === "errors" ? "errors" : "audit";
    const load = async (before) => {
      if (tab === "audit") {
        const qs = new URLSearchParams({ limit: "100" });
        if (query.get("action")) qs.set("action", query.get("action")); if (query.get("q")) qs.set("q", query.get("q")); if (before) qs.set("before", before);
        return api("GET", A + "/audit?" + qs);
      }
      const qs = new URLSearchParams({ limit: "100" });
      if (query.get("source")) qs.set("source", query.get("source")); if (before) qs.set("before", before);
      return api("GET", A + "/errors?" + qs);
    };
    const r = await load(query.get("before"));
    on.submit.filter = (f, v) => { const qs = new URLSearchParams(Object.entries(v).filter(([, x]) => x)); location.hash = `#logs/${tab}${qs.toString() ? "?" + qs : ""}`; };
    on.click.more = async (el) => {
      const more = await load(el.dataset.before);
      const tb = main.querySelector("#log-rows");
      tb.insertAdjacentHTML("beforeend", show(more.rows.map(tab === "audit" ? auditRow : errorRow)));
      if (more.next) el.dataset.before = more.next; else el.remove();
    };
    const tabs = html`<span class="seg"><a class="btn small ${tab === "audit" ? "on" : ""}" href="#logs/audit">Audit log</a><a class="btn small ${tab === "errors" ? "on" : ""}" href="#logs/errors">Errors</a></span>`;
    const filter = tab === "audit"
      ? html`<form class="card row" data-form="filter"><label>Action starts with<input name="action" value="${query.get("action") || ""}" placeholder="user. or settings." autocomplete="off"></label><label class="grow">Target or actor contains<input name="q" value="${query.get("q") || ""}" placeholder="email, site, flag…" autocomplete="off"></label><button class="btn" type="submit">Filter</button></form>`
      : html`<form class="card row" data-form="filter"><label>Source<select name="source"><option value="">All sources</option>${r.sources.map((x) => html`<option value="${x.source}"${raw(x.source === query.get("source") ? " selected" : "")}>${x.source} (${int(x.n)})</option>`)}</select></label><button class="btn" type="submit">Filter</button></form>`;
    const head = tab === "audit" ? ["When", "Actor", "Action", "Target", "Before", "After"] : ["When", "Source", "Code", "Message", "User", "Ticker", "Context"];
    return html`<div class="head"><div><h1>Logs</h1><p class="muted small">Newest first. ${tab === "audit" ? "Every admin change, sign-in and new account." : "Server-side failures: upstream data, Claude, mail, and unhandled errors."}</p></div>${tabs}</div>
      ${filter}
      <div class="card">${r.rows.length ? html`<div class="wrap"><table class="t"><thead><tr>${head.map((h) => html`<th>${h}</th>`)}</tr></thead><tbody id="log-rows">${r.rows.map(tab === "audit" ? auditRow : errorRow)}</tbody></table></div>
        ${r.next ? html`<div class="row" style="margin-top:10px"><button class="btn" type="button" data-act="more" data-before="${r.next}">Load older</button></div>` : ""}` : html`<p class="empty">Nothing logged${query.toString() ? " for this filter" : ""}.</p>`}</div>`;
  };
  const auditRow = (a) => html`<tr><td>${timeCell(a.at)}</td><td class="break small">${a.actor_email || a.actor_id || "system"}</td><td class="mono small">${a.action}</td><td class="break small">${a.target || ""}</td><td>${jsonBlock(a.before)}</td><td>${jsonBlock(a.after)}</td></tr>`;
  const errorRow = (e) => html`<tr><td>${timeCell(e.at)}</td><td><span class="badge">${e.source}</span></td><td class="mono small">${e.code || ""}</td><td class="break small">${e.message || ""}</td><td class="break small">${e.user_email || ""}</td><td class="mono small">${e.ticker || ""}</td><td>${jsonBlock(e.context)}</td></tr>`;

  // ---------- settings ----------
  const LIC = [
    ["fmp_display", "FMP display licence", "Lets people other than the owner see FMP data. Until it's recorded, only the owner can sign in."],
    ["edgar_tools_display", "Edgar Tools display licence", "Lets the app show Edgar Tools filing data to other accounts."],
    ["legal", "Legal review", "Terms, privacy policy and tax set-up checked. Needed, with the FMP licence, before billing can be turned on."],
  ];
  VIEWS.settings = async ({ on }) => {
    const r = await api("GET", A + "/settings");
    const own = isOwner(), dis = ownerAttr();
    const after = (res, msg) => { toast(msg); return res; };
    on.submit.licence = async (f, v) => { after(await api("POST", A + "/settings/licences", { which: v.which, signed_at: v.signed_at, reference: v.reference || undefined, note: v.note || undefined }), "Licence recorded."); rerender(); };
    on.click.clearLicence = async (el) => {
      if (!confirmed("Clear this record?" + (el.dataset.which === "fmp_display" ? " Everyone but the owner will be unable to sign in." : ""))) return;
      after(await api("POST", A + "/settings/licences", { which: el.dataset.which, clear: true }), "Cleared."); rerender();
    };
    on.submit.billing = async (f) => {
      const enabled = f.enabled.checked, live = f.live.checked;
      if (live && !r.billing.live && !confirmed("Go live? Real cards will be charged.")) return;
      after(await api("POST", A + "/settings/billing", { enabled, live }), `Billing ${enabled ? (live ? "on, live" : "on, test mode") : "off"}.`); rerender();
    };
    on.submit.signups = async (f) => { after(await api("POST", A + "/settings/signups", { open: f.open.checked }), f.open.checked ? "Sign-ups open." : "Sign-ups closed."); rerender(); };
    on.submit.budgets = async (f, v) => {
      const val = v.global_claude_usd_day.trim() === "" ? null : Number(v.global_claude_usd_day);
      after(await api("POST", A + "/settings/budgets", { global_claude_usd_day: val }), val === null ? "No daily cap." : "Daily cap set to " + usd2(val) + "."); rerender();
    };
    const L = r.licences, B = r.billing, E = r.env;
    const tick = (ok, label) => html`<li>${ok ? html`<span class="badge ok">done</span>` : html`<span class="badge warn">missing</span>`} ${label}</li>`;
    const licCard = ([k, title, text]) => {
      const x = L[k];
      return html`<div class="card"><h2>${title} ${x ? html`<span class="badge ok">recorded</span>` : html`<span class="badge warn">not recorded</span>`}</h2>
        <p class="small muted">${text}</p>
        ${x ? html`<table class="kv"><tr><th>Signed</th><td>${x.signed_at}</td></tr><tr><th>Reference</th><td class="break">${x.reference || DASH}</td></tr>${x.note ? html`<tr><th>Note</th><td class="break">${x.note}</td></tr>` : ""}<tr><th>Recorded</th><td>${x.recorded_by || DASH} · ${when(x.recorded_at)}</td></tr></table>` : ""}
        <form class="row" data-form="licence" style="margin-top:10px"><input type="hidden" name="which" value="${k}">
          <label>Signed on<input type="date" name="signed_at" required value="${x ? x.signed_at : ""}"${dis}></label>
          <label class="grow">Reference<input name="reference" maxlength="200" value="${x ? x.reference || "" : ""}" placeholder="Contract or order number"${dis}></label>
          <label class="grow">Note<input name="note" maxlength="1000" value="${x ? x.note || "" : ""}"${dis}></label>
          <button class="btn primary" type="submit"${dis}>${x ? "Update" : "Record"}</button>
          ${x ? html`<button class="btn danger" type="button" data-act="clearLicence" data-which="${k}"${dis}>Clear</button>` : ""}
        </form></div>`;
    };
    const updated = (k) => (r.updated[k] && r.updated[k].at ? html`<p class="hint">Last changed ${when(r.updated[k].at)}${r.updated[k].by ? " by " + r.updated[k].by : ""}.</p>` : "");
    return html`<div class="head"><div><h1>Settings</h1><p class="muted small">${own ? "Changes are recorded in the audit log." : "Read-only: only the owner can change settings."}</p></div></div>
      ${licenceBanner(r.licensed_for_others)}
      <h3>Licences and checks</h3>
      <div class="cards">${LIC.map(licCard)}</div>
      <h3>Access and spend</h3>
      <div class="cards">
        <form class="card" data-form="billing"><h2>Billing ${B.enabled ? html`<span class="badge ok">on</span> ${B.live ? html`<span class="badge acc">live</span>` : html`<span class="badge">test</span>`}` : html`<span class="badge">off</span>`}</h2>
          <ul class="small" style="list-style:none;padding:0;margin:0 0 10px">${tick(L.fmp_display, "FMP display licence")}${tick(L.legal, "Legal review")}${tick(E.stripe.configured, "STRIPE_SECRET_KEY on the server" + (E.stripe.mode ? ` (${E.stripe.mode} key)` : ""))}${tick(E.stripe.webhook, "STRIPE_WEBHOOK_SECRET on the server")}</ul>
          <label class="check"><input type="checkbox" name="enabled"${raw(B.enabled ? " checked" : "")}${dis}> Billing on (plans, checkout, free tier for new users)</label>
          <label class="check"><input type="checkbox" name="live"${raw(B.live ? " checked" : "")}${dis}> Live mode (real charges)</label>
          <p class="hint">Billing can't be turned on until both records above exist; live mode also needs the Stripe key. Turning billing off turns live mode off.</p>
          <div class="row"><button class="btn primary" type="submit"${dis}>Save billing</button></div>${updated("billing")}
        </form>
        <div class="stack">
          <form class="card" data-form="signups"><h2>Sign-ups</h2>
            <label class="check"><input type="checkbox" name="open"${raw(r.signups.open ? " checked" : "")}${dis}> Open: anyone can create an account</label>
            <p class="hint">${r.licensed_for_others ? "When closed, only people on the allowlist can sign in." : "Has no effect yet: until the FMP display licence is recorded, only the owner can sign in."}</p>
            <div class="row"><button class="btn primary" type="submit"${dis}>Save</button></div>${updated("signups")}
          </form>
          <form class="card" data-form="budgets"><h2>Claude daily cap</h2>
            <div class="row"><label>All users together, per UTC day (US$)<input name="global_claude_usd_day" type="number" min="0.01" step="0.01" value="${r.budgets.global_claude_usd_day ?? ""}" placeholder="no cap"${dis}></label>
            <button class="btn primary" type="submit"${dis}>Save</button></div>
            <p class="hint">When reached, Claude features pause for everyone but the owner until midnight UTC. Leave empty for no cap; to switch Claude off, use the flags.</p>${updated("budgets")}
          </form>
        </div>
      </div>
      <h3>Server</h3>
      <div class="card"><table class="kv">
        <tr><th>Owner</th><td class="break">${E.owner_email || DASH}</td></tr>
        <tr><th>Claude</th><td>${E.claude.stub ? html`<span class="badge warn">stub</span>` : html`<span class="badge ok">API</span>`} ${E.claude.key ? "key set" : "no key"}</td></tr>
        <tr><th>FMP</th><td>${E.fmp.fixtures ? "fixtures (test data)" : E.fmp.key ? "API key set" : html`<span class="badge warn">no key</span>`}</td></tr>
        <tr><th>Email</th><td>${E.mail}</td></tr>
        <tr><th>Stripe</th><td>${E.stripe.configured ? E.stripe.mode + " key" : "not configured"} · webhook ${E.stripe.webhook ? "secret set" : "not set"}</td></tr>
        <tr><th>Admin TOTP required</th><td>${yesNo(E.require_admin_mfa)}</td></tr>
      </table><p class="hint">These come from the server's environment; secrets are never shown.</p></div>`;
  };

  // ---------- plans ----------
  const LIMIT_LABEL = { companies: "Companies / period", saved_models: "Saved models", drafts: "Notes drafts", translations: "Translations", guidance: "Guidance reads", segment_fills: "Segment fills",
    exports: "Downloads", claude_soft_usd: "Claude soft cap (US$)", claude_hard_usd: "Claude hard cap (US$)", fmp_calls_day: "FMP calls / day" };
  VIEWS.plans = async ({ on }) => {
    const r = await api("GET", A + "/plans");
    S.plans = r;
    const dis = ownerAttr();
    on.submit.plan = async (f, v) => {
      const limits = {};
      for (const k of r.limit_keys) { const x = (v["l_" + k] || "").trim(); limits[k] = x === "" ? null : Number(x); }
      await api("POST", A + "/plans/" + encodeURIComponent(f.dataset.id), { name: v.name, active: f.active.checked, limits });
      S.plans = null; toast("Plan saved."); rerender();
    };
    const priceText = (p) => Object.entries(p.currency_options || {}).map(([c, v]) => money(typeof v === "object" && v ? v.unit_amount : v, c)).join(" · ");
    return html`<div class="head"><div><h1>Plans</h1><p class="muted small">Limits apply per billing period (calendar month without a subscription). Empty means no limit. ${isOwner() ? "" : "Only the owner can change plans."}</p></div></div>
      ${r.plans.map((p) => html`<form class="card" data-form="plan" data-id="${p.id}">
        <div class="head"><div><h2>${p.name} <span class="muted mono small">${p.id}</span> ${p.active ? "" : html`<span class="badge">inactive</span>`}</h2>
          <p class="small muted">${int(p.subscribers)} subscription${p.subscribers === 1 ? "" : "s"} · ${int(p.comps)} comp${p.comps === 1 ? "" : "s"}</p></div></div>
        <div class="row">
          <label>Name<input name="name" value="${p.name}" maxlength="60" required${dis}></label>
          <label class="check"><input type="checkbox" name="active"${raw(p.active ? " checked" : "")}${raw(!isOwner() || p.id === "owner" ? " disabled" : "")}> Active</label>
        </div>
        <div class="tiles" style="margin:12px 0 10px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
          ${r.limit_keys.map((k) => html`<label class="field">${LIMIT_LABEL[k] || k}<input name="l_${k}" type="number" min="0" step="${k.startsWith("claude_") ? "0.01" : "1"}" value="${p.limits[k] ?? ""}" placeholder="no limit"${dis}></label>`)}
        </div>
        ${p.prices.length ? html`<h3>Prices</h3>${table(["Stripe price", "Interval", "Lookup key", "Amounts", "Active"], p.prices.map((x) => html`<tr><td class="mono small break">${x.id}</td><td>${x.interval}</td><td class="mono small">${x.lookup_key || ""}</td><td>${priceText(x)}</td><td>${yesNo(x.active)}</td></tr>`))}` : ""}
        <div class="row" style="margin-top:10px"><button class="btn primary" type="submit"${dis}>Save ${p.name}</button></div>
      </form>`)}`;
  };

  // ---------- boot ----------
  async function boot() {
    try { S.me = await api("GET", "/api/me"); }
    catch (e) { if (e.status === 401) return signInGate(); return errorGate(e); }
    if (S.me.role !== "owner" && S.me.role !== "admin") return notAdminGate(S.me.email);
    try { S.admin = await api("GET", A + "/me-admin"); }
    catch (e) { if (e.status === 403) return notAdminGate(S.me.email); return errorGate(e); }
    try { S.overview = await api("GET", A + "/overview"); }
    catch (e) { if (e.code === "mfa_required") return mfaGate(); if (e.status === 403) return notAdminGate(S.me.email); return errorGate(e); }
    shell();
    route();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
