// The web app's stand-in for claude.ai's window.claude: the page (public/app.html, built from templates/src/page.html
// unchanged) asks for capabilities with window.claude.use(name), and this file answers them from the app's own API.
//   mcp        -> POST /api/tools      (FMP and Edgar Tools, keys stay on the server)
//   sample     -> POST /api/sample     (Claude, streamed as server-sent events)
//   db         -> /api/docs            (the signed-in user's saved models)
//   downloads  -> a browser download, counted against the plan by POST /api/meter/export
//   user       -> the signed-in user's id
// It also draws the sign-in screen and the account menu. Loaded as a classic script in <head>, before the page runs.
(function () {
  "use strict";
  var LS = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del: function (k) { try { localStorage.removeItem(k); } catch (e) {} } };
  var lang = function () { var v = LS.get("tmpl.lang"); return v === "ja" || v === "zh" ? v : "en"; };
  var S = {
    en: { title: "Sign in", lead: "Enter your email and we'll send you a six-digit code.", email: "Email", send: "Send code", code: "Code", verify: "Sign in", sent: "If this email has access, a code is on its way. It expires in 10 minutes.", back: "Use a different email", wait: "Working…", signout: "Sign out", admin: "Admin", plan: "Plan", usage: "This period", resets: "Resets", companies: "Companies", savedList: "Saved models", delModel: "Delete", delModelQ: "Delete the saved model for {t}, with its segment data and call summaries? This can't be undone.", none: "None yet.", retrying: "Couldn't reach the server. Trying again…", saved: "Saved models", drafts: "Notes drafts", translations: "Translations", guidance: "Guidance reads", segment_fills: "Segment fills", exports: "Downloads", claude: "Claude budget used", unlimited: "no limit", billing: "Plans and billing", stub: "Claude stub mode", devmail: "Development: codes appear in the server log and at /dev/mail.", expired: "Your session has ended. Sign in again.", del: "Delete account", delq: "Type your email address to delete this account and its saved models. This can't be undone.", deleted: "Your account has been deleted.", soft: "You've used most of this period's Claude budget." },
    ja: { title: "サインイン", lead: "メールアドレスを入力してください。6桁のコードをお送りします。", email: "メールアドレス", send: "コードを送信", code: "コード", verify: "サインイン", sent: "このメールアドレスにアクセス権があれば、コードを送信しました。有効期限は10分です。", back: "別のメールアドレスを使う", wait: "処理中…", signout: "サインアウト", admin: "管理", plan: "プラン", usage: "今期の利用", resets: "リセット日", companies: "企業数", savedList: "保存したモデル", delModel: "削除", delModelQ: "{t} の保存したモデルを、セグメントデータと決算説明会の要約とともに削除しますか？元に戻せません。", none: "まだありません。", retrying: "サーバーに接続できません。再試行しています…", saved: "保存したモデル", drafts: "ノートの下書き", translations: "翻訳", guidance: "ガイダンスの読み取り", segment_fills: "セグメントの取り込み", exports: "ダウンロード", claude: "Claude 予算の使用", unlimited: "上限なし", billing: "プランとお支払い", stub: "Claude スタブモード", devmail: "開発環境：コードはサーバーログと /dev/mail に表示されます。", expired: "セッションが終了しました。もう一度サインインしてください。", del: "アカウントを削除", delq: "このアカウントと保存したモデルを削除するには、メールアドレスを入力してください。元に戻せません。", deleted: "アカウントを削除しました。", soft: "今期の Claude 予算の大半を使用しました。" },
    zh: { title: "登入", lead: "輸入電子郵件，我們會寄送六位數驗證碼給您。", email: "電子郵件", send: "寄送驗證碼", code: "驗證碼", verify: "登入", sent: "如果此電子郵件有存取權限，驗證碼已寄出，10 分鐘內有效。", back: "改用其他電子郵件", wait: "處理中…", signout: "登出", admin: "管理", plan: "方案", usage: "本期用量", resets: "重設日", companies: "公司數", savedList: "已儲存的模型", delModel: "刪除", delModelQ: "要刪除 {t} 已儲存的模型，以及其分部資料與法說會摘要嗎？此動作無法復原。", none: "尚無資料。", retrying: "無法連線到伺服器，正在重試…", saved: "已儲存的模型", drafts: "筆記草稿", translations: "翻譯", guidance: "財測讀取", segment_fills: "分部資料讀取", exports: "下載", claude: "Claude 預算使用", unlimited: "無上限", billing: "方案與付款", stub: "Claude 模擬模式", devmail: "開發環境：驗證碼會顯示在伺服器記錄與 /dev/mail。", expired: "您的工作階段已結束，請重新登入。", del: "刪除帳戶", delq: "輸入您的電子郵件以刪除此帳戶及已儲存的模型。此動作無法復原。", deleted: "您的帳戶已刪除。", soft: "您已用掉本期大部分的 Claude 預算。" },
  };
  var L = function (k) { return (S[lang()] || S.en)[k] || S.en[k]; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  // ---------- API ----------
  function apiError(status, body) {
    var e = new Error((body && body.message) || ("HTTP " + status));
    e.code = (body && body.code) || (status === 401 ? "session_expired" : "server_error");
    e.status = status;
    if (body) { if (body.retryable) e.retryable = true; if (body.retryAfterMs) e.retryAfterMs = body.retryAfterMs; if (body.limit) e.limit = body.limit; }
    return e;
  }
  async function api(method, path, body) {
    var res = await fetch(path, { method: method, credentials: "same-origin", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    var data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) { var err = apiError(res.status, data); onApiError(err); throw err; }
    return data;
  }
  function onApiError(e) {
    if (e.status === 401) { showSignIn(L("expired")); }
    else if (e.code === "quota_exceeded" || e.code === "feature_disabled" || e.code === "not_licensed" || e.code === "maintenance") toast(e.message);
  }

  // ---------- who is signed in ----------
  var me = null, resolveReady;
  var ready = new Promise(function (r) { resolveReady = r; });
  // saved models live per user in this browser too (the page's own cache): drop them when a different user signs in
  function clearLocalModels() {
    var drop = ["tmpl.ticker"]; // the last company opened, so the next user doesn't start on (and pay for) it
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (/^tmpl\.(inp\.|sec\.|calls-)/.test(k || "")) drop.push(k); } } catch (e) {}
    drop.forEach(LS.del);
  }
  async function boot() {
    try { me = await api("GET", "/api/me"); }
    catch (e) { if (e.status === 401) { showSignIn(); return; } toast(L("retrying")); setTimeout(boot, 5000); return; }
    if (LS.get("cm.uid") !== me.uid) { clearLocalModels(); LS.set("cm.uid", me.uid); }
    drawChip();
    resolveReady(me);
  }

  // ---------- capabilities ----------
  var mcpCache = new Map();
  var pendingSaves = {};
  var mcp = {
    callTool: async function (server, tool, input, opts) {
      var key = JSON.stringify([server, tool, input]), stale = (opts && opts.cache && opts.cache.staleTime) || 0;
      var hit = mcpCache.get(key);
      if (hit && Date.now() - hit.at < stale) return { payload: hit.payload };
      var r = await api("POST", "/api/tools", { server: server, tool: tool, input: input });
      if (stale) mcpCache.set(key, { at: Date.now(), payload: r.payload });
      if (mcpCache.size > 400) mcpCache.delete(mcpCache.keys().next().value);
      return { payload: r.payload };
    },
  };

  // the company the page has loaded, sent with Claude requests for metering
  var currentTicker = function () { var el = document.getElementById("ticker"); return (LS.get("tmpl.ticker") || (el && el.value) || "").toUpperCase(); };
  async function streamSample(input, opts, json) {
    opts = opts || {};
    var res = await fetch("/api/sample", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ input: input, json: !!json, cache: opts.cache !== false, ticker: currentTicker() }) });
    if (!res.ok || !/event-stream/.test(res.headers.get("content-type") || "")) {
      var data = null; try { data = await res.json(); } catch (e) {}
      var err = apiError(res.status, data); onApiError(err); throw err;
    }
    var reader = res.body.getReader(), dec = new TextDecoder(), buf = "", text = "", done = null;
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      var at;
      while ((at = buf.indexOf("\n\n")) >= 0) {
        var block = buf.slice(0, at); buf = buf.slice(at + 2);
        var line = block.split("\n").filter(function (l) { return l.indexOf("data:") === 0; }).map(function (l) { return l.slice(5).trim(); }).join("");
        if (!line) continue;
        var ev; try { ev = JSON.parse(line); } catch (e) { continue; }
        if (ev.type === "text") { var prev = text; text = ev.text; if (opts.onText) { try { opts.onText({ text: text, delta: text.slice(prev.length) }); } catch (e) {} } }
        else if (ev.type === "done") done = ev;
        else if (ev.type === "error") { var e2 = apiError(ev.status || 500, ev); onApiError(e2); throw e2; }
      }
    }
    if (!done) throw apiError(502, { code: "claude_error", message: "The answer was cut off. Try again." });
    if (done.warning === "claude_soft_cap") toast(L("soft"));
    if (opts.onText && done.text !== text) { try { opts.onText({ text: done.text, delta: done.text.slice(text.length) }); } catch (e) {} }
    return done;
  }
  var sample = function (input, opts) { return streamSample(input, opts, false).then(function (d) { return { text: d.text, truncated: !!d.truncated }; }); };
  sample.json = function (input, opts) {
    return streamSample(input, opts, true).then(function (d) {
      if (d.truncated) throw apiError(502, { code: "truncated", message: "Claude's answer was cut short." });
      return d.json;
    });
  };

  // the page's data store: collection("data/users/<uid>").doc(id).get() / .set(), collection(...).get()
  var db = {
    collection: function (path) {
      var own = function () { if (!me || path !== "data/users/" + me.uid) throw apiError(403, { code: "forbidden", message: "Not your data." }); };
      return {
        doc: function (id) {
          var url = "/api/docs/" + encodeURIComponent(id);
          return {
            get: async function () { own(); var r = await api("GET", url); return { exists: !!r.exists, id: id, data: function () { return r.data; } }; },
            set: async function (data) {
              own();
              for (var i = 0; ; i++) {
                try { await api("PUT", url, { data: data }); delete pendingSaves[url]; return; }
                catch (e) {
                  if (e.status === 401) pendingSaves[url] = data; // sent again once the user signs back in
                  if (e.status === 429 && e.retryAfterMs && i < 4) { await new Promise(function (r) { setTimeout(r, e.retryAfterMs + 200); }); continue; }
                  throw e;
                }
              }
            },
          };
        },
        get: async function () { own(); var r = await api("GET", "/api/docs"); return { docs: r.docs.map(function (d) { return { id: d.id, data: function () { return d.data; } }; }) }; },
      };
    },
  };

  var MIME = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf", json: "application/json", csv: "text/csv" };
  var downloads = {
    save: async function (file) {
      var name = String((file && file.filename) || "download");
      await api("POST", "/api/meter/export", { filename: name });
      var data = file.data, type = file.mimeType || MIME[(name.split(".").pop() || "").toLowerCase()] || "application/octet-stream";
      var blob = data instanceof Blob ? data : new Blob([data], { type: type });
      var a = document.createElement("a"), url = URL.createObjectURL(blob);
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      return { ok: true };
    },
  };
  var user = { id: async function () { return me && me.uid; } };
  var permissions = { manage: async function () { openPanel(); } };

  window.claude = {
    use: function (name) {
      return ready.then(function (m) {
        var caps = m.caps || {};
        switch (name) {
          case "mcp": return mcp;
          case "db": return db;
          case "user": return user;
          case "sample": return caps.sample ? sample : null;
          case "downloads": return caps.downloads ? downloads : null;
          case "permissions": return permissions;
          default: return null;
        }
      });
    },
  };

  // ---------- UI: sign-in screen, account chip and panel, toasts ----------
  var CSS = ".cm-ov{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:var(--cm-bg);color:var(--cm-fg);font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;padding:16px}" +
    ".cm-card{width:100%;max-width:380px;background:var(--cm-card);border:1px solid var(--cm-line);border-radius:12px;padding:28px 24px;box-shadow:0 8px 30px rgba(0,0,0,.08)}" +
    ".cm-card h1{font-size:22px;margin:0 0 6px}.cm-card p{margin:0 0 16px;color:var(--cm-mut)}.cm-card label{display:block;font-size:13px;color:var(--cm-mut);margin:0 0 4px}" +
    ".cm-card input{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid var(--cm-line);border-radius:8px;background:var(--cm-bg);color:var(--cm-fg);margin:0 0 14px}" +
    ".cm-card input.cm-code{letter-spacing:.4em;font-size:22px;text-align:center}.cm-btn{font:inherit;font-weight:600;cursor:pointer;border:0;border-radius:8px;padding:10px 14px;background:var(--cm-acc);color:#fff;width:100%}" +
    ".cm-btn[disabled]{opacity:.6;cursor:default}.cm-link{background:none;border:0;color:var(--cm-acc);cursor:pointer;font:inherit;padding:8px 0 0;font-size:13px}.cm-err{color:#c0392b;font-size:13px;min-height:18px;margin:-6px 0 8px}" +
    ".cm-langs{display:flex;gap:6px;justify-content:flex-end;margin:-12px -8px 8px 0}.cm-langs button{background:none;border:1px solid var(--cm-line);border-radius:6px;color:var(--cm-mut);font:12px system-ui;padding:2px 7px;cursor:pointer}.cm-langs button[aria-pressed=true]{color:var(--cm-fg);border-color:var(--cm-fg)}" +
    ".cm-fine{font-size:12px;color:var(--cm-mut);margin-top:14px}" +
    ".cm-chip{position:fixed;right:12px;bottom:12px;z-index:2147482000;display:flex;gap:8px;align-items:center;background:var(--cm-card);color:var(--cm-fg);border:1px solid var(--cm-line);border-radius:999px;padding:6px 12px;font:13px system-ui,-apple-system,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.08);cursor:pointer;max-width:calc(100vw - 24px)}" +
    ".cm-chip .cm-dot{width:8px;height:8px;border-radius:50%;background:#2e9d5b;flex:none}.cm-chip .cm-who{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}.cm-tag{font-size:11px;padding:1px 6px;border-radius:999px;background:var(--cm-tag);color:var(--cm-fg)}" +
    ".cm-panel{position:fixed;right:12px;bottom:56px;z-index:2147482001;width:320px;max-width:calc(100vw - 24px);background:var(--cm-card);color:var(--cm-fg);border:1px solid var(--cm-line);border-radius:12px;padding:16px;font:13px/1.45 system-ui,-apple-system,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.12)}" +
    ".cm-panel table{width:100%;border-collapse:collapse;margin:6px 0 12px}.cm-panel td{padding:3px 0;text-align:left;border:0;font:inherit;color:inherit;background:none}.cm-panel td:last-child{text-align:right;font-variant-numeric:tabular-nums}.cm-panel h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--cm-mut);margin:10px 0 2px}" +
    ".cm-panel .cm-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.cm-panel a,.cm-panel button.cm-act{flex:1;text-align:center;text-decoration:none;font:inherit;font-weight:600;border:1px solid var(--cm-line);border-radius:8px;padding:8px;background:none;color:var(--cm-fg);cursor:pointer}" +
    ".cm-mlist{max-height:180px;overflow:auto;border:1px solid var(--cm-line);border-radius:8px;padding:4px 10px;margin:6px 0}.cm-mrow{display:flex;justify-content:space-between;align-items:center}.cm-mrow .cm-link{padding:4px 0}" +
    ".cm-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:64px;z-index:2147483001;background:#222;color:#fff;border-radius:8px;padding:10px 14px;font:14px system-ui,sans-serif;max-width:min(560px,calc(100vw - 32px));box-shadow:0 4px 20px rgba(0,0,0,.2)}" +
    ":root{--cm-bg:#f7f7f5;--cm-card:#fff;--cm-fg:#1d1d1b;--cm-mut:#6b6b66;--cm-line:#dcdcd6;--cm-acc:#1f5fbf;--cm-tag:#ecece6}" +
    "@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--cm-bg:#161615;--cm-card:#1f1f1d;--cm-fg:#ecebe6;--cm-mut:#a3a29b;--cm-line:#3a3a36;--cm-acc:#5b9bff;--cm-tag:#2c2c29}}" +
    ":root[data-theme=dark]{--cm-bg:#161615;--cm-card:#1f1f1d;--cm-fg:#ecebe6;--cm-mut:#a3a29b;--cm-line:#3a3a36;--cm-acc:#5b9bff;--cm-tag:#2c2c29}";
  function injectCss() { if (document.getElementById("cm-css")) return; var st = document.createElement("style"); st.id = "cm-css"; st.textContent = CSS; (document.head || document.documentElement).appendChild(st); }
  function onBody(fn) { if (document.body) fn(); else document.addEventListener("DOMContentLoaded", fn, { once: true }); }

  var toastTimer;
  function toast(msg) {
    onBody(function () {
      injectCss();
      var el = document.getElementById("cm-toast");
      if (!el) { el = document.createElement("div"); el.id = "cm-toast"; el.className = "cm-toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
      el.textContent = msg; el.hidden = false;
      clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 7000);
    });
  }

  function showSignIn(note) {
    onBody(function () {
      injectCss();
      var ov = document.getElementById("cm-signin");
      if (!ov) { ov = document.createElement("div"); ov.id = "cm-signin"; ov.className = "cm-ov"; document.body.appendChild(ov); }
      var step = "email", email = "";
      var draw = function (err) {
        var l = lang();
        ov.innerHTML = '<form class="cm-card" novalidate><div class="cm-langs">' + ["en", "ja", "zh"].map(function (x) { return '<button type="button" data-l="' + x + '" aria-pressed="' + (x === l) + '">' + { en: "EN", ja: "日本語", zh: "繁中" }[x] + "</button>"; }).join("") + "</div>" +
          "<h1>" + esc(L("title")) + "</h1>" + (note && step === "email" ? "<p>" + esc(note) + "</p>" : "") +
          (step === "email"
            ? "<p>" + esc(L("lead")) + '</p><label for="cm-email">' + esc(L("email")) + '</label><input id="cm-email" type="email" autocomplete="email" required value="' + esc(email) + '"><div class="cm-err" role="alert">' + esc(err || "") + '</div><button class="cm-btn" type="submit">' + esc(L("send")) + "</button>"
            : "<p>" + esc(L("sent")) + '</p><label for="cm-code">' + esc(L("code")) + '</label><input id="cm-code" class="cm-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}"><div class="cm-err" role="alert">' + esc(err || "") + '</div><button class="cm-btn" type="submit">' + esc(L("verify")) + '</button><button type="button" class="cm-link" data-back>' + esc(L("back")) + "</button>") +
          (window.__CM_DEV ? '<div class="cm-fine">' + esc(L("devmail")) + "</div>" : "") + "</form>";
        var f = ov.querySelector("form");
        ov.querySelectorAll("[data-l]").forEach(function (b) { b.onclick = function () { LS.set("tmpl.lang", b.dataset.l); draw(); }; });
        var back = ov.querySelector("[data-back]"); if (back) back.onclick = function () { step = "email"; draw(); };
        var inp = ov.querySelector("input"); setTimeout(function () { inp && inp.focus(); }, 0);
        f.onsubmit = async function (ev) {
          ev.preventDefault();
          var btn = f.querySelector(".cm-btn"); btn.disabled = true; btn.textContent = L("wait");
          try {
            if (step === "email") { email = inp.value.trim(); await api("POST", "/auth/start", { email: email, locale: lang() }); step = "code"; draw(); }
            else { await api("POST", "/auth/verify", { email: email, code: inp.value.trim() }); await resumeAfterSignIn(ov); }
          } catch (e) { draw(e.message); }
        };
      };
      draw();
    });
  }

  // the session ended while the page was open: if the same user signs back in, keep the page as it is (unsaved edits
  // included) and send the saves that failed; anyone else starts afresh
  async function resumeAfterSignIn(ov) {
    var prev = me;
    if (!prev) { location.reload(); return; }
    var next;
    try { next = await api("GET", "/api/me"); } catch (e) { location.reload(); return; }
    if (next.uid !== prev.uid) { clearLocalModels(); LS.set("cm.uid", next.uid); location.reload(); return; }
    me = next; ov.remove(); drawChip();
    var urls = Object.keys(pendingSaves);
    for (var i = 0; i < urls.length; i++) {
      try { await api("PUT", urls[i], { data: pendingSaves[urls[i]] }); delete pendingSaves[urls[i]]; } catch (e) {}
    }
  }

  function drawChip() {
    onBody(function () {
      injectCss();
      var chip = document.getElementById("cm-chip");
      if (!chip) { chip = document.createElement("button"); chip.type = "button"; chip.id = "cm-chip"; chip.className = "cm-chip"; chip.setAttribute("aria-haspopup", "dialog"); document.body.appendChild(chip); chip.onclick = function () { togglePanel(); }; }
      chip.innerHTML = '<span class="cm-dot"></span><span class="cm-who">' + esc(me.email) + '</span><span class="cm-tag">' + esc(me.plan.name) + "</span>" + (me.claude && me.claude.stub ? '<span class="cm-tag">' + esc(L("stub")) + "</span>" : "");
    });
  }
  function togglePanel() { var p = document.getElementById("cm-panel"); if (p && !p.hidden) p.hidden = true; else openPanel(); }
  async function openPanel() {
    try { me = await api("GET", "/api/me"); } catch (e) { return; }
    var p = document.getElementById("cm-panel");
    if (!p) { p = document.createElement("div"); p.id = "cm-panel"; p.className = "cm-panel"; p.setAttribute("role", "dialog"); document.body.appendChild(p); document.addEventListener("keydown", function (e) { if (e.key === "Escape") p.hidden = true; }); }
    var u = me.usage, lim = u.limits, used = u.used;
    var row = function (k, a, b) { return "<tr><td>" + esc(L(k)) + "</td><td>" + esc(a) + " / " + esc(b == null ? L("unlimited") : b) + "</td></tr>"; };
    var claudeRow = lim.claude_hard_usd ? "<tr><td>" + esc(L("claude")) + "</td><td>" + (me.role === "owner" ? "$" + used.claude_usd.toFixed(2) + " / $" + lim.claude_hard_usd : Math.min(100, Math.round((used.claude_usd / lim.claude_hard_usd) * 100)) + "%") + "</td></tr>" : "";
    p.innerHTML = "<div><b>" + esc(me.email) + "</b></div><div>" + esc(L("plan")) + ": " + esc(me.plan.name) + "</div>" +
      "<h3>" + esc(L("usage")) + "</h3><table>" + row("companies", used.companies, lim.companies) + row("saved", me.savedModels, lim.saved_models) +
      (me.caps.sample ? row("drafts", used.drafts, lim.drafts) + row("translations", used.translations, lim.translations) + row("guidance", used.guidance, lim.guidance) + row("segment_fills", used.segment_fills, lim.segment_fills) : "") +
      row("exports", used.exports, lim.exports) + claudeRow + "</table>" +
      '<button type="button" class="cm-link" data-models>' + esc(L("savedList")) + ' ▾</button><div data-model-list hidden class="cm-mlist"></div>' + "<div class=\"cm-fine\">" + esc(L("resets")) + ": " + esc(new Date(u.period.end).toLocaleDateString()) + "</div>" +
      '<div class="cm-row">' + (me.billing && me.billing.enabled ? '<a href="/account">' + esc(L("billing")) + "</a>" : "") + (me.role === "owner" || me.role === "admin" ? '<a href="/admin">' + esc(L("admin")) + "</a>" : "") +
      '<button type="button" class="cm-act" data-out>' + esc(L("signout")) + "</button></div>" +
      (me.role === "owner" ? "" : '<button type="button" class="cm-link" data-del>' + esc(L("del")) + "</button>");
    p.hidden = false;
    var list = p.querySelector("[data-models]");
    if (list) {
      list.onclick = async function () {
        var box = p.querySelector("[data-model-list]");
        if (!box.hidden) { box.hidden = true; return; }
        var r; try { r = await api("GET", "/api/docs?meta=1"); } catch (e) { return; }
        var models = r.docs.filter(function (d) { return d.kind === "model"; });
        box.innerHTML = models.length ? models.map(function (d) {
          var t = d.id.slice(6);
          return '<div class="cm-mrow"><span>' + esc(d.ticker || t) + '</span><button type="button" class="cm-link" data-delm="' + esc(t) + '">' + esc(L("delModel")) + "</button></div>";
        }).join("") : '<div class="cm-fine">' + esc(L("none")) + "</div>";
        box.hidden = false;
        box.querySelectorAll("[data-delm]").forEach(function (b) {
          b.onclick = async function () {
            var t = b.dataset.delm;
            if (!window.confirm(L("delModelQ").replace("{t}", t))) return;
            try { await api("DELETE", "/api/docs/" + encodeURIComponent("model-" + t), {}); } catch (e) { toast(e.message); return; }
            ["tmpl.inp." + t, "tmpl.sec." + t, "tmpl.calls-" + t].forEach(LS.del);
            if ((LS.get("tmpl.ticker") || "") === t) { LS.del("tmpl.ticker"); location.reload(); return; }
            b.parentNode.remove();
          };
        });
      };
    }
    var del = p.querySelector("[data-del]");
    if (del) del.onclick = async function () {
      var typed = window.prompt(L("delq"));
      if (!typed) return;
      try { await api("POST", "/api/account/delete", { confirm: typed }); } catch (e) { toast(e.message); return; }
      clearLocalModels(); LS.del("cm.uid"); alert(L("deleted")); location.reload();
    };
    p.querySelector("[data-out]").onclick = async function () {
      try { await api("POST", "/auth/logout", {}); } catch (e) {}
      clearLocalModels(); LS.del("cm.uid"); location.reload();
    };
  }

  boot();
})();
