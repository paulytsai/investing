// The account page (/account): the signed-in user's plan and usage, the plans on offer, Stripe Checkout and the
// customer portal, and recent invoices. Text follows the model page's language (localStorage tmpl.lang, as shim.js).
// Everything shown is escaped; the only redirects allowed are Stripe's hosted pages and this page itself.
(function () {
  "use strict";
  var LS = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  var lang = function () { var v = LS.get("tmpl.lang"); return v === "ja" || v === "zh" ? v : "en"; };

  var S = {
    en: {
      title: "Plans and billing", back: "Back to the model", loading: "Loading…", testMode: "Test mode", mockTag: "Mock",
      yourPlan: "Your plan", src_subscription: "Subscription", src_comp: "Complimentary", src_owner: "Owner", src_default: "Default",
      ownerNote: "As the owner you aren't billed. In test mode you can still try checkout.",
      compNote: "You're on a complimentary plan.", freeNoteCur: "You're on the free plan.",
      renews: "Renews on {d}.", ends: "Ends on {d}. You keep the plan until then.", trialEnds: "Free trial until {d}, then {plan}.",
      pastDue: "Your last payment failed. Update your card by {d} to keep your plan.", needsPayment: "A payment is needed to restart your plan.",
      canceled: "Your subscription has ended.",
      manage: "Manage billing", changePlan: "Change plan",
      usage: "This period", resets: "Resets on {d}.",
      l_companies: "Companies a month", l_saved: "Saved models", l_drafts: "Notes drafts", l_translations: "Translations", l_guidance: "Guidance reads",
      l_segment_fills: "Segment fills", l_exports: "Downloads", l_claude: "Claude features", yes: "Yes", no: "No", unlimited: "No limit",
      plans: "Plans", monthly: "Monthly", yearly: "Yearly", save: "2 months free", currency: "Currency", interval: "Billing period",
      perMonth: "/ month", perYear: "/ year", yearEq: "{x} a month, billed yearly",
      freePrice: "Free", freeSub: "No card needed.", trialPrice: "14 days free", trialSub: "Then Plus at {x}. Card required; cancel any time before the trial ends.",
      subscribe: "Subscribe", startTrial: "Start free trial", current: "Current plan", trialUsed: "Trial already used", pricesMissing: "Not on sale yet",
      billingOff: "Paid plans aren't available yet. Everyone invited has a complimentary plan for now.",
      taxNote: "Any sales tax or VAT is worked out at checkout. Payments are handled by Stripe; you can cancel any time.",
      invoices: "Invoices", noInvoices: "No invoices yet.", date: "Date", amount: "Amount", status: "Status", view: "View",
      inv_paid: "Paid", inv_open: "Due", inv_void: "Void", inv_uncollectible: "Unpaid", inv_draft: "Draft",
      checkoutSuccess: "Thanks! Your subscription is being set up. This page updates in a few seconds.", nowActive: "Your {plan} plan is active.",
      stillPending: "Stripe hasn't confirmed the subscription yet. Reload this page in a minute.",
      checkoutCancel: "Checkout was canceled. You haven't been charged.",
      mockTitle: "Mock checkout (development)", mockLead: "No Stripe key is set, so checkout is simulated here. Nothing is charged.",
      mockComplete: "Complete mock checkout", mockCancel: "Cancel",
      mockPortalTitle: "Mock billing portal (development)", mockPortalLead: "Stripe's customer portal stands in here while no Stripe key is set.",
      mockCancelSub: "Cancel subscription (mock)", mockCanceled: "The mock subscription is canceled.", backToPlans: "Back to plans",
      signedOut: "Sign in on the main page to see your plan.", signIn: "Sign in", working: "Working…", dismiss: "Dismiss",
      err_billing_off: "Paid plans aren't available yet.", err_already: "You already have a subscription. Change it under Manage billing.",
      err_trial_used: "You've already had a free trial.", err_rate: "Too many attempts. Try again in a moment.",
      err_not_configured: "This plan isn't on sale yet.", err_stripe: "Payments are unavailable right now. Try again in a few minutes.",
      err_no_customer: "There's no billing account yet. Choose a plan first.", err_bad_token: "That mock checkout has expired. Start again.",
      err_generic: "Something went wrong. Try again.",
    },
    ja: {
      title: "プランとお支払い", back: "モデルに戻る", loading: "読み込み中…", testMode: "テストモード", mockTag: "模擬",
      yourPlan: "現在のプラン", src_subscription: "サブスクリプション", src_comp: "無償提供", src_owner: "オーナー", src_default: "標準",
      ownerNote: "オーナーには請求されません。テストモードでは購入手続きを試せます。",
      compNote: "無償提供のプランをご利用中です。", freeNoteCur: "無料プランをご利用中です。",
      renews: "{d} に更新されます。", ends: "{d} に終了します。それまではこのプランをご利用いただけます。", trialEnds: "{d} まで無料トライアル、その後は {plan} になります。",
      pastDue: "前回のお支払いに失敗しました。プランを維持するには {d} までにカード情報を更新してください。", needsPayment: "プランを再開するにはお支払いが必要です。",
      canceled: "サブスクリプションは終了しました。",
      manage: "お支払いの管理", changePlan: "プランを変更",
      usage: "今期の利用", resets: "{d} にリセットされます。",
      l_companies: "企業数（月）", l_saved: "保存したモデル", l_drafts: "ノートの下書き", l_translations: "翻訳", l_guidance: "ガイダンスの読み取り",
      l_segment_fills: "セグメントの取り込み", l_exports: "ダウンロード", l_claude: "Claude 機能", yes: "あり", no: "なし", unlimited: "上限なし",
      plans: "プラン", monthly: "月払い", yearly: "年払い", save: "2か月分お得", currency: "通貨", interval: "お支払い周期",
      perMonth: "／月", perYear: "／年", yearEq: "年払いで月あたり {x}",
      freePrice: "無料", freeSub: "カード登録は不要です。", trialPrice: "14日間無料", trialSub: "その後は Plus（{x}）。カード登録が必要です。トライアル終了前ならいつでも解約できます。",
      subscribe: "申し込む", startTrial: "無料トライアルを開始", current: "ご利用中", trialUsed: "トライアルは利用済みです", pricesMissing: "準備中",
      billingOff: "有料プランはまだ提供していません。招待された方は当面、無償でご利用いただけます。",
      taxNote: "消費税などの税金は購入手続き時に計算されます。お支払いは Stripe が処理します。いつでも解約できます。",
      invoices: "請求書", noInvoices: "請求書はまだありません。", date: "日付", amount: "金額", status: "状態", view: "表示",
      inv_paid: "支払済み", inv_open: "未払い", inv_void: "無効", inv_uncollectible: "回収不能", inv_draft: "下書き",
      checkoutSuccess: "ありがとうございます。サブスクリプションを設定しています。数秒でこのページに反映されます。", nowActive: "{plan} プランが有効になりました。",
      stillPending: "Stripe からの確認がまだ届いていません。1分ほどしてからページを再読み込みしてください。",
      checkoutCancel: "購入手続きをキャンセルしました。料金は発生していません。",
      mockTitle: "模擬チェックアウト（開発用）", mockLead: "Stripe キーが設定されていないため、ここで購入手続きを模擬します。請求は発生しません。",
      mockComplete: "模擬チェックアウトを完了", mockCancel: "キャンセル",
      mockPortalTitle: "模擬お支払いポータル（開発用）", mockPortalLead: "Stripe キーが未設定のため、Stripe のカスタマーポータルの代わりに表示しています。",
      mockCancelSub: "サブスクリプションを解約（模擬）", mockCanceled: "模擬サブスクリプションを解約しました。", backToPlans: "プランに戻る",
      signedOut: "プランを確認するには、メインページでサインインしてください。", signIn: "サインイン", working: "処理中…", dismiss: "閉じる",
      err_billing_off: "有料プランはまだ提供していません。", err_already: "すでにサブスクリプションがあります。「お支払いの管理」から変更してください。",
      err_trial_used: "無料トライアルは利用済みです。", err_rate: "試行回数が多すぎます。少し待ってからもう一度お試しください。",
      err_not_configured: "このプランはまだ販売していません。", err_stripe: "現在お支払いを処理できません。数分後にもう一度お試しください。",
      err_no_customer: "お支払い情報がまだありません。先にプランをお選びください。", err_bad_token: "模擬チェックアウトの有効期限が切れました。もう一度お試しください。",
      err_generic: "問題が発生しました。もう一度お試しください。",
    },
    zh: {
      title: "方案與付款", back: "返回模型", loading: "載入中…", testMode: "測試模式", mockTag: "模擬",
      yourPlan: "目前方案", src_subscription: "訂閱", src_comp: "免費贈送", src_owner: "擁有者", src_default: "預設",
      ownerNote: "擁有者不需付費。在測試模式下仍可試用結帳流程。",
      compNote: "您目前使用免費贈送的方案。", freeNoteCur: "您目前使用免費方案。",
      renews: "將於 {d} 續訂。", ends: "將於 {d} 結束，在此之前仍可使用此方案。", trialEnds: "免費試用至 {d}，之後轉為 {plan}。",
      pastDue: "上次付款失敗。請在 {d} 前更新付款資訊，以保留您的方案。", needsPayment: "需要完成付款才能恢復您的方案。",
      canceled: "您的訂閱已結束。",
      manage: "管理付款", changePlan: "變更方案",
      usage: "本期用量", resets: "將於 {d} 重設。",
      l_companies: "每月公司數", l_saved: "已儲存的模型", l_drafts: "筆記草稿", l_translations: "翻譯", l_guidance: "財測讀取",
      l_segment_fills: "分部資料讀取", l_exports: "下載", l_claude: "Claude 功能", yes: "有", no: "無", unlimited: "無上限",
      plans: "方案", monthly: "月繳", yearly: "年繳", save: "省下兩個月", currency: "幣別", interval: "付款週期",
      perMonth: "／月", perYear: "／年", yearEq: "年繳，相當於每月 {x}",
      freePrice: "免費", freeSub: "不需信用卡。", trialPrice: "免費試用 14 天", trialSub: "之後為 Plus（{x}）。需要信用卡，試用結束前可隨時取消。",
      subscribe: "訂閱", startTrial: "開始免費試用", current: "目前方案", trialUsed: "已使用過試用", pricesMissing: "尚未開放",
      billingOff: "付費方案尚未開放。受邀用戶目前可免費使用。",
      taxNote: "營業稅等稅額會在結帳時計算。付款由 Stripe 處理，可隨時取消。",
      invoices: "發票", noInvoices: "目前沒有發票。", date: "日期", amount: "金額", status: "狀態", view: "查看",
      inv_paid: "已付款", inv_open: "待付款", inv_void: "已作廢", inv_uncollectible: "無法收款", inv_draft: "草稿",
      checkoutSuccess: "感謝您！正在設定您的訂閱，幾秒後此頁面會更新。", nowActive: "您的 {plan} 方案已生效。",
      stillPending: "Stripe 尚未確認訂閱。請稍候一分鐘後重新整理此頁面。",
      checkoutCancel: "已取消結帳，您不會被收費。",
      mockTitle: "模擬結帳（開發用）", mockLead: "尚未設定 Stripe 金鑰，因此在此模擬結帳流程，不會收費。",
      mockComplete: "完成模擬結帳", mockCancel: "取消",
      mockPortalTitle: "模擬付款管理（開發用）", mockPortalLead: "尚未設定 Stripe 金鑰，因此以此頁代替 Stripe 客戶入口。",
      mockCancelSub: "取消訂閱（模擬）", mockCanceled: "已取消模擬訂閱。", backToPlans: "返回方案",
      signedOut: "請先在主頁登入以查看您的方案。", signIn: "登入", working: "處理中…", dismiss: "關閉",
      err_billing_off: "付費方案尚未開放。", err_already: "您已有訂閱，請在「管理付款」中變更。",
      err_trial_used: "您已使用過免費試用。", err_rate: "嘗試次數過多，請稍後再試。",
      err_not_configured: "此方案尚未開放購買。", err_stripe: "目前無法處理付款，請幾分鐘後再試。",
      err_no_customer: "目前沒有付款帳戶，請先選擇方案。", err_bad_token: "模擬結帳已過期，請重新開始。",
      err_generic: "發生錯誤，請再試一次。",
    },
  };
  var L = function (k, vars) {
    var s = (S[lang()] || S.en)[k]; if (s == null) s = S.en[k]; if (s == null) s = k;
    if (vars) Object.keys(vars).forEach(function (n) { s = s.split("{" + n + "}").join(vars[n]); });
    return s;
  };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var LOC = { en: "en-US", ja: "ja-JP", zh: "zh-TW" };
  var ERR = { billing_off: "err_billing_off", already_subscribed: "err_already", trial_used: "err_trial_used", rate_limited: "err_rate", not_configured: "err_not_configured",
    mode_mismatch: "err_not_configured", stripe_error: "err_stripe", no_customer: "err_no_customer", bad_token: "err_bad_token" };
  var OPEN = ["active", "trialing", "past_due", "unpaid", "paused"];
  var CURRENCIES = ["usd", "jpy", "twd"];

  // ---------- formatting ----------
  // amounts arrive in Stripe's minor units: JPY has none; TWD and USD have two
  function money(minor, cur) {
    if (minor == null || !cur) return "—";
    var zero = cur === "jpy", v = zero ? minor : minor / 100, whole = Math.round(v) === v;
    try { return new Intl.NumberFormat(LOC[lang()], { style: "currency", currency: cur.toUpperCase(), minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: zero ? 0 : 2 }).format(v); }
    catch (e) { return cur.toUpperCase() + " " + v; }
  }
  // a yearly price per month: cents for USD, whole units for JPY and TWD
  var monthlyOf = function (minor, cur) { return cur === "twd" ? Math.round(minor / 1200) * 100 : Math.round(minor / 12); };
  function day(iso) { if (!iso) return "—"; var d = new Date(iso); return isNaN(d) ? "—" : d.toLocaleDateString(LOC[lang()], { year: "numeric", month: "short", day: "numeric" }); }
  var num = function (n) { return Number(n || 0).toLocaleString(LOC[lang()]); };
  var lim = function (v) { return v == null ? L("unlimited") : v === 0 ? "—" : num(v); };
  function defaultCurrency() {
    var saved = LS.get("cm.currency");
    if (CURRENCIES.indexOf(saved) >= 0) return saved;
    var nl = String(navigator.language || "").toLowerCase();
    if (/^ja\b/.test(nl)) return "jpy";
    if (/^zh-(tw|hant-tw)\b/.test(nl)) return "twd";
    return "usd";
  }

  // ---------- state and API ----------
  var qs = new URLSearchParams(location.search);
  var st = { me: null, bill: null, signedOut: false, loadError: null, notice: null, busy: null,
    interval: LS.get("cm.interval") === "year" ? "year" : "month", currency: defaultCurrency(),
    mockToken: qs.get("mock_checkout"), mockPortal: qs.get("mock_portal") === "1" };

  async function api(method, path, body) {
    var res = await fetch(path, { method: method, credentials: "same-origin", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    var data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) { var err = new Error((data && data.message) || "HTTP " + res.status); err.status = res.status; err.code = data && data.code; throw err; }
    return data;
  }
  // server messages are English; known codes get the page's language
  var errNotice = function (e) { return e && e.code && ERR[e.code] ? { kind: "err", key: ERR[e.code] } : { kind: "err", text: lang() === "en" && e && e.message ? e.message : L("err_generic") }; };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // only Stripe's hosted pages or this page
  function go(url) {
    var u; try { u = new URL(url, location.origin); } catch (e) { return; }
    var ok = (u.origin === location.origin && u.pathname === "/account") || (u.protocol === "https:" && /(^|\.)stripe\.com$/.test(u.hostname));
    if (ok) location.assign(u.href);
  }

  async function load() {
    try {
      var r = await Promise.all([api("GET", "/api/me"), api("GET", "/api/billing/status")]);
      st.me = r[0]; st.bill = r[1]; st.signedOut = false; st.loadError = null;
    } catch (e) {
      if (e.status === 401) st.signedOut = true; else st.loadError = errNotice(e);
    }
    render();
  }

  // ---------- actions ----------
  async function checkout(plan, trial) {
    st.busy = trial ? "trial" : plan; st.notice = null; render();
    try {
      var r = await api("POST", "/api/billing/checkout", { plan: plan, interval: st.interval, currency: st.currency, trial: !!trial, lang: lang() });
      go(r.url);
    } catch (e) {
      st.busy = null;
      if (e.code === "already_subscribed") return portal();
      st.notice = errNotice(e); render();
    }
  }
  async function portal() {
    st.busy = "portal"; render();
    try { var r = await api("POST", "/api/billing/portal", { lang: lang() }); go(r.url); }
    catch (e) { st.busy = null; st.notice = errNotice(e); render(); }
  }
  async function mockComplete() {
    st.busy = "mock"; render();
    try { await api("POST", "/api/billing/mock/complete", { token: st.mockToken }); location.replace("/account?checkout=success"); }
    catch (e) { st.busy = null; st.notice = errNotice(e); render(); }
  }
  async function mockCancel() {
    st.busy = "mock"; render();
    try {
      await api("POST", "/api/billing/mock/cancel", {});
      st.mockPortal = false; history.replaceState(null, "", "/account");
      st.busy = null; st.notice = { kind: "ok", key: "mockCanceled" };
      await load();
    } catch (e) { st.busy = null; st.notice = errNotice(e); render(); }
  }
  // back from Checkout: the webhook may land a moment after the redirect, so look a few times
  async function afterCheckout() {
    st.notice = { kind: "ok", key: "checkoutSuccess" };
    history.replaceState(null, "", "/account");
    for (var i = 0; i < 8; i++) {
      await load();
      var s = st.bill && st.bill.current.subscription;
      if (s && (s.status === "active" || s.status === "trialing")) { st.notice = { kind: "ok", key: "nowActive", vars: { plan: st.me.plan.name } }; render(); return; }
      if (st.signedOut || st.loadError) return;
      await sleep(2000);
    }
    st.notice = { kind: "warn", key: "stillPending" }; render();
  }

  // ---------- drawing ----------
  var btn = function (label, attrs, cls) { return '<button type="button" class="btn' + (cls ? " " + cls : "") + '"' + (attrs || "") + ">" + esc(label) + "</button>"; };
  var busyBtn = function (key, label, attrs, cls) { return st.busy ? btn(st.busy === key ? L("working") : label, attrs + " disabled", cls) : btn(label, attrs, cls); };

  function header() {
    var b = st.bill;
    return '<header class="top"><a class="back" href="/">← ' + esc(L("back")) + '</a><div class="langs" role="group" aria-label="Language">' +
      ["en", "ja", "zh"].map(function (x) { return '<button type="button" data-act="lang" data-v="' + x + '" aria-pressed="' + (x === lang()) + '">' + { en: "EN", ja: "日本語", zh: "繁中" }[x] + "</button>"; }).join("") +
      "</div></header><h1>" + esc(L("title")) + (b && b.enabled && !b.live ? ' <span class="tag">' + esc(L("testMode")) + "</span>" : "") + "</h1>";
  }
  function noticeHtml(n, fixed) {
    if (!n) return "";
    return '<div class="notice ' + esc(n.kind) + '" role="' + (n.kind === "err" ? "alert" : "status") + '"><span>' + esc(n.key ? L(n.key, n.vars) : n.text) + "</span>" +
      (fixed ? "" : '<button type="button" data-act="dismiss" aria-label="' + esc(L("dismiss")) + '">×</button>') + "</div>";
  }

  function priceOf(planId, interval) {
    var p = (st.bill.plans || []).filter(function (x) { return x.id === planId; })[0];
    return p && p.prices.filter(function (x) { return x.interval === (interval || st.interval) && x.currency === st.currency; })[0] || null;
  }
  var planName = function (id) { var p = (st.bill.plans || []).filter(function (x) { return x.id === id; })[0]; return p ? p.name : id; };

  function mockPanel() {
    var b = st.bill;
    if (!b.mock) return "";
    if (st.mockToken) {
      return '<section class="card mock"><h2>' + esc(L("mockTitle")) + '</h2><p class="mut">' + esc(L("mockLead")) + '</p><div class="row">' +
        busyBtn("mock", L("mockComplete"), ' data-act="mock-complete"') + '<a class="btn sec" href="/account?checkout=cancel">' + esc(L("mockCancel")) + "</a></div></section>";
    }
    if (st.mockPortal) {
      var s = b.current.subscription, open = s && s.mock && ["active", "trialing", "past_due"].indexOf(s.status) >= 0;
      return '<section class="card mock"><h2>' + esc(L("mockPortalTitle")) + '</h2><p class="mut">' + esc(L("mockPortalLead")) + '</p><div class="row">' +
        (open ? busyBtn("mock", L("mockCancelSub"), ' data-act="mock-cancel"') : "") + '<a class="btn sec" href="/account">' + esc(L("backToPlans")) + "</a></div></section>";
    }
    return "";
  }

  function currentCard() {
    // with billing off, subscriptions grant nothing (meter.js), so they aren't described
    var me = st.me, b = st.bill, cur = b.current, s = b.enabled ? cur.subscription : null, u = me.usage, used = u.used, lims = u.limits;
    var line = "";
    if (cur.source === "owner") line = L("ownerNote");
    else if (cur.source === "comp" || (cur.source === "default" && me.plan.id === "comp")) line = L("compNote");
    if (s && cur.source !== "owner") {
      if (s.status === "trialing") line = L("trialEnds", { d: day(s.trial_end), plan: planName(s.pricePlan || "plus") });
      else if (s.status === "past_due") line = L("pastDue", { d: day(s.grace_until) });
      else if (s.status === "active") line = s.cancel_at_period_end ? L("ends", { d: day(s.current_period_end) }) : L("renews", { d: day(s.current_period_end) });
      else if (s.status === "unpaid" || s.status === "paused" || s.status === "incomplete") line = L("needsPayment");
      else if (s.status === "canceled" && me.plan.id === "free") line = L("canceled");
    } else if (!line && me.plan.id === "free") line = L("freeNoteCur");
    var rows = [["l_companies", used.companies, lims.companies], ["l_saved", me.savedModels, lims.saved_models], ["l_drafts", used.drafts, lims.drafts],
      ["l_translations", used.translations, lims.translations], ["l_guidance", used.guidance, lims.guidance], ["l_segment_fills", used.segment_fills, lims.segment_fills],
      ["l_exports", used.exports, lims.exports]];
    var manage = b.enabled && b.hasPortal ? busyBtn("portal", L("manage"), ' data-act="portal"', "sec") : "";
    return '<section class="card" aria-labelledby="cur-h"><h2 id="cur-h">' + esc(L("yourPlan")) + '</h2><div class="cur-head"><div>' +
      '<span class="cur-name">' + esc(me.plan.name) + "</span>" + (cur.source !== "default" ? '<span class="tag acc">' + esc(L("src_" + cur.source)) + "</span>" : "") +
      (s && s.mock ? ' <span class="tag">' + esc(L("mockTag")) + "</span>" : "") +
      (line ? '<p class="cur-line">' + esc(line) + "</p>" : "") + "</div>" + manage + "</div>" +
      '<h2 style="margin:18px 0 0;font-size:14px" class="mut">' + esc(L("usage")) + '</h2><table class="usage"><tbody>' +
      rows.map(function (r) { return "<tr><td>" + esc(L(r[0])) + "</td><td>" + esc(num(r[1])) + " / " + esc(lim(r[2])) + "</td></tr>"; }).join("") +
      "<tr><td>" + esc(L("l_claude")) + "</td><td>" + esc(lims.claude_hard_usd ? L("yes") : L("no")) + "</td></tr></tbody></table>" +
      '<p class="fine">' + esc(L("resets", { d: day(u.period && u.period.end) })) + "</p></section>";
  }

  function planAction(p) {
    var b = st.bill, s = b.current.subscription, open = s && OPEN.indexOf(s.status) >= 0 ? s : null;
    if (!b.enabled) return "";
    if (p.id === "free") return "";
    if (open) {
      var subPlan = open.status === "trialing" ? "trial" : open.plan;
      if (subPlan === p.id) return btn(L("current"), " disabled", "sec wide");
      if (p.id === "trial") return "";
      return busyBtn("portal", L("changePlan"), ' data-act="portal"', "sec wide");
    }
    if (p.id === "trial") {
      if (!b.trialAvailable) return btn(L("trialUsed"), " disabled", "sec wide");
      if (!priceOf("plus")) return btn(L("pricesMissing"), " disabled", "sec wide");
      return busyBtn("trial", L("startTrial"), ' data-act="checkout" data-plan="plus" data-trial="1"', "wide");
    }
    if (!priceOf(p.id)) return btn(L("pricesMissing"), " disabled", "sec wide");
    return busyBtn(p.id, L("subscribe"), ' data-act="checkout" data-plan="' + esc(p.id) + '"', "wide");
  }

  function planCard(p) {
    var isCur = st.me.plan.id === p.id, per = st.interval === "year" ? L("perYear") : L("perMonth");
    var price, sub;
    if (p.id === "free") { price = esc(L("freePrice")); sub = L("freeSub"); }
    else if (p.id === "trial") {
      var plus = priceOf("plus");
      price = esc(L("trialPrice"));
      sub = plus ? L("trialSub", { x: money(plus.amount, st.currency) + " " + per }) : "";
    } else {
      var pr = priceOf(p.id);
      price = pr ? esc(money(pr.amount, st.currency)) + '<span class="per">' + esc(per) + "</span>" : "—";
      sub = pr && st.interval === "year" ? L("yearEq", { x: money(monthlyOf(pr.amount, st.currency), st.currency) }) : "";
    }
    var l = p.limits || {};
    var items = [["companies", "l_companies"], ["saved_models", "l_saved"], ["drafts", "l_drafts"], ["translations", "l_translations"], ["guidance", "l_guidance"],
      ["segment_fills", "l_segment_fills"], ["exports", "l_exports"]];
    return '<article class="plan' + (isCur ? " is-cur" : "") + '"><h3><span>' + esc(p.name) + "</span>" + (isCur ? '<span class="tag acc">' + esc(L("current")) + "</span>" : "") + "</h3>" +
      '<div class="price">' + price + '</div><p class="sub">' + esc(sub) + '</p><ul class="lims">' +
      items.map(function (it) { return "<li><span>" + esc(L(it[1])) + "</span><b>" + esc(lim(l[it[0]])) + "</b></li>"; }).join("") +
      "<li><span>" + esc(L("l_claude")) + "</span><b>" + esc(l.claude_hard_usd > 0 ? L("yes") : L("no")) + "</b></li></ul>" + planAction(p) + "</article>";
  }

  function plansSection() {
    var b = st.bill;
    return '<section class="card" aria-labelledby="plans-h"><div class="plans-head"><h2 id="plans-h">' + esc(L("plans")) + '</h2><div class="controls">' +
      '<div class="seg" role="group" aria-label="' + esc(L("interval")) + '">' +
      '<button type="button" data-act="interval" data-v="month" aria-pressed="' + (st.interval === "month") + '">' + esc(L("monthly")) + "</button>" +
      '<button type="button" data-act="interval" data-v="year" aria-pressed="' + (st.interval === "year") + '">' + esc(L("yearly")) + '<span class="save">' + esc(L("save")) + "</span></button></div>" +
      '<label class="curpick">' + esc(L("currency")) + ' <select id="cur">' +
      CURRENCIES.map(function (c) { return '<option value="' + c + '"' + (c === st.currency ? " selected" : "") + ">" + c.toUpperCase() + "</option>"; }).join("") + "</select></label></div></div>" +
      (b.enabled ? "" : noticeHtml({ kind: "warn", key: "billingOff" }, true)) +
      '<div class="plans">' + b.plans.map(planCard).join("") + "</div>" +
      (b.enabled ? '<p class="fine">' + esc(L("taxNote")) + "</p>" : "") + "</section>";
  }

  function invoicesSection() {
    var inv = st.bill.invoices || [];
    if (!inv.length && !st.bill.enabled) return "";
    return '<section class="card" aria-labelledby="inv-h"><h2 id="inv-h">' + esc(L("invoices")) + "</h2>" +
      (!inv.length ? '<p class="mut">' + esc(L("noInvoices")) + "</p>" :
        '<table class="inv"><thead><tr><th>' + esc(L("date")) + "</th><th>" + esc(L("amount")) + "</th><th>" + esc(L("status")) + "</th><th></th></tr></thead><tbody>" +
        inv.map(function (i) {
          var url = /^https:\/\//.test(i.hosted_invoice_url || "") ? i.hosted_invoice_url : null;
          return "<tr><td>" + esc(day(i.created_at)) + "</td><td>" + esc(money(i.status === "paid" ? i.amount_paid : i.amount_due, i.currency)) + "</td><td>" + esc(L("inv_" + i.status)) + "</td><td>" +
            (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(L("view")) + "</a>" : "") + "</td></tr>";
        }).join("") + "</tbody></table>") + "</section>";
  }

  function render() {
    document.documentElement.lang = { en: "en", ja: "ja", zh: "zh-Hant-TW" }[lang()];
    document.title = L("title");
    var root = document.getElementById("root"), focus = document.activeElement && document.activeElement.id;
    var body;
    if (st.signedOut) body = '<section class="card"><p>' + esc(L("signedOut")) + '</p><a class="btn" href="/">' + esc(L("signIn")) + "</a></section>";
    else if (st.loadError && !st.bill) body = noticeHtml(st.loadError);
    else if (!st.me || !st.bill) body = '<p class="mut">' + esc(L("loading")) + "</p>";
    else body = noticeHtml(st.notice) + mockPanel() + currentCard() + plansSection() + invoicesSection();
    root.innerHTML = header() + body;
    if (focus) { var el = document.getElementById(focus); if (el) el.focus(); }
  }

  // ---------- events ----------
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest && ev.target.closest("[data-act]");
    if (!el || el.disabled) return;
    var act = el.getAttribute("data-act");
    if (act === "lang") { LS.set("tmpl.lang", el.getAttribute("data-v")); render(); }
    else if (act === "interval") { st.interval = el.getAttribute("data-v") === "year" ? "year" : "month"; LS.set("cm.interval", st.interval); render(); }
    else if (act === "checkout") checkout(el.getAttribute("data-plan"), el.getAttribute("data-trial") === "1");
    else if (act === "portal") portal();
    else if (act === "mock-complete") mockComplete();
    else if (act === "mock-cancel") mockCancel();
    else if (act === "dismiss") { st.notice = null; render(); }
  });
  document.addEventListener("change", function (ev) {
    if (ev.target && ev.target.id === "cur" && CURRENCIES.indexOf(ev.target.value) >= 0) { st.currency = ev.target.value; LS.set("cm.currency", st.currency); render(); }
  });
  // back/forward cache: a page restored after leaving for Stripe shouldn't keep a stuck "Working…" button
  window.addEventListener("pageshow", function (ev) { if (ev.persisted && st.busy) { st.busy = null; render(); } });

  function init() {
    var ck = qs.get("checkout");
    if (ck === "cancel") { st.notice = { kind: "warn", key: "checkoutCancel" }; history.replaceState(null, "", "/account"); }
    render();
    if (ck === "success") afterCheckout(); else load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
