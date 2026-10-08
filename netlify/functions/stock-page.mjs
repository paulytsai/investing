// Server-rendered ticker page at /s/:symbol. Crawlers and logged-out visitors get a
// real HTML preview (profile, story, key figures, JSON-LD); the app script then takes
// over in the browser and shows the full page to subscribers.
import fs from "node:fs/promises";
import { stockBundle, normalizeSymbol } from "../lib/stockdata.mjs";
import { teaserData } from "./teaser.mjs";
import { siteMeta, applyHead, esc } from "../lib/seo.mjs";
import { cfg } from "../lib/config.mjs";
import { logEvent } from "../lib/events.mjs";

async function shell() {
  for (const p of [new URL("../../public/index.html", import.meta.url), "public/index.html", "/var/task/public/index.html"]) {
    try { return await fs.readFile(p, "utf8"); } catch {}
  }
  return null;
}

const fmtBig = (m, lang) => (m == null ? "—" : lang === "en" ? `US$${(m / 1000).toFixed(m >= 100000 ? 0 : 1)}B` : `${Math.round(m / 100).toLocaleString()}億ドル`);
const L = {
  ja: { preview: "無料プレビュー", profile: "プロフィール", story: "この1年のストーリー", figures: "主要指標", price: "株価", cap: "時価総額", pe: "PER（今期予想）", pbr: "PBR", yld: "配当利回り", range: "52週レンジ", sector: "業種", exchange: "上場", indices: "構成銘柄", comps: "比較会社", locked: "長期トレンド・直近動向・強気／弱気シナリオ・業績10年・バリュエーション・テクニカル・株主・役員・深掘り分析は会員向けです。", cta: "7日間無料で全文を読む", login: "ログイン", titleSuffix: "の業績・財務・株価・AI要約", descPrefix: "の1ページ要約：", nextEarnings: "次回決算", updated: "更新" },
  en: { preview: "Free preview", profile: "Profile", story: "The past year's story", figures: "Key figures", price: "Price", cap: "Market cap", pe: "P/E (forward)", pbr: "P/B", yld: "Dividend yield", range: "52-week range", sector: "Sector", exchange: "Listed", indices: "Index membership", comps: "Competitors", locked: "Long-term trend, recent quarters, bull and bear cases, ten years of results, valuation, technical read, holders, officers and the deep dive are for members.", cta: "Read the full page free for 7 days", login: "Log in", titleSuffix: " stock: results, financials, valuation and AI digest", descPrefix: " one-page almanac: ", nextEarnings: "Next earnings", updated: "Updated" },
  "zh-TW": { preview: "免費預覽", profile: "公司簡介", story: "過去一年的故事", figures: "主要指標", price: "股價", cap: "市值", pe: "本益比（預估）", pbr: "股價淨值比", yld: "殖利率", range: "52週區間", sector: "產業", exchange: "上市", indices: "指數成分股", comps: "同業", locked: "長期趨勢、近期動態、多空論點、十年業績、估值、技術面、股東、經營層與深度分析為會員內容。", cta: "免費試用 7 天閱讀全文", login: "登入", titleSuffix: " 業績・財務・股價與 AI 摘要", descPrefix: " 一頁年鑑：", nextEarnings: "下次財報", updated: "更新" },
};

export default async (req, context) => {
  const lang = cfg.defaultLocale();
  const T = L[lang] || L.en;
  const m = siteMeta(lang);
  let symbol;
  try { symbol = normalizeSymbol(context.params.symbol); } catch { return new Response("Not found", { status: 404 }); }
  const html = await shell();
  if (!html) return Response.redirect(`${m.url}/#/s/${symbol}`, 302);
  let d;
  try { d = await teaserData(symbol, lang); } catch (e) {
    const page = applyHead(html, { title: `${symbol} | ${m.brand.name}`, description: m.description, canonical: `${m.url}/s/${symbol}`, lang, jsonLd: [], ogImage: m.ogImage, noindex: true });
    return new Response(page, { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
  }
  await logEvent("teaser_page", { detail: symbol, req }).catch(() => {});
  const c = d.company, mk = d.market;
  const title = `${c.name}（${symbol}）${T.titleSuffix} | ${m.brand.name}`.replace("（", lang === "en" ? " (" : "（").replace("）", lang === "en" ? ")" : "）");
  const desc = `${c.name} (${symbol})${T.descPrefix}${(d.feature || c.description || "").slice(0, 150)}`;
  const canonical = `${m.url}/s/${symbol}`;
  const jsonLd = [
    { "@context": "https://schema.org", "@type": "WebPage", name: title, url: canonical, inLanguage: lang, description: desc, isPartOf: { "@type": "WebSite", name: m.brand.name, url: m.url }, about: { "@type": "Corporation", name: c.name, tickerSymbol: symbol, url: c.website || undefined, address: c.address || undefined, numberOfEmployees: c.employees ? { "@type": "QuantitativeValue", value: c.employees } : undefined }, dateModified: d.generatedAt || d.asOf },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: m.brand.name, item: `${m.url}/` }, { "@type": "ListItem", position: 2, name: `${c.name} (${symbol})`, item: canonical }] },
  ];
  const chg = mk.change ?? 0; const sign = chg > 0 ? "+" : "";
  const kv = [[T.price, mk.price != null ? `$${mk.price.toFixed(2)} (${sign}${(mk.changePct ?? 0).toFixed(2)}%)` : "—"], [T.cap, fmtBig(mk.marketCapM, lang)], [T.pe, mk.peForward != null ? mk.peForward.toFixed(1) : "—"], [T.pbr, mk.pbr != null ? mk.pbr.toFixed(1) : "—"], [T.yld, mk.dividendYieldPct != null ? `${mk.dividendYieldPct.toFixed(2)}%` : "—"], [T.range, mk.yearLow != null ? `$${mk.yearLow.toFixed(2)} – $${mk.yearHigh.toFixed(2)}` : "—"], [T.sector, `${c.sector || ""} / ${c.industry || ""}`], [T.exchange, c.exchange || ""], [T.indices, c.indices.length ? c.indices.map((x) => `${x.index}${x.weightPct != null ? ` ${x.weightPct.toFixed(2)}%` : ""}`).join(" · ") : "—"]];
  const body = `
    <article class="teaser panel">
      <p class="pill">${T.preview}</p>
      <h1>${esc(c.name)} <span class="muted">(${esc(symbol)}) · ${esc(c.exchange || "")}</span></h1>
      ${d.feature ? `<h2 class="sub">${T.profile}</h2><p class="feature">${esc(d.feature)}</p>` : c.description ? `<h2 class="sub">${T.profile}</h2><p class="feature">${esc(c.description.slice(0, 600))}</p>` : ""}
      ${d.story ? `<h2 class="sub">${T.story}</h2><div class="deep-story"><div class="hl">${esc(d.story.headline)}</div><p>${esc(d.story.body)}</p></div>` : ""}
      <h2 class="sub">${T.figures}</h2>
      <dl class="kv2">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      ${d.competitors.length ? `<p class="muted small">${T.comps}: ${d.competitors.map((x) => (x.us ? `<a href="/s/${esc(x.symbol)}">${esc(x.symbol)}</a>` : esc(x.symbol)) + (x.name ? ` ${esc(x.name)}` : "")).join("、")}</p>` : ""}
      <div class="teaser-lock"><p>${T.locked}</p><a class="btn primary big" href="/#/signup">${T.cta}</a> <a class="btn" href="/#/login">${T.login}</a></div>
      <p class="note">${d.nextEarnings ? `${T.nextEarnings}: ${esc(d.nextEarnings)} · ` : ""}${T.updated}: ${esc((d.generatedAt || d.asOf || "").slice(0, 10))}</p>
    </article>`;
  let page = applyHead(html, { title, description: desc, canonical, lang, jsonLd, ogImage: m.ogImage });
  page = page.replace('<main id="app"></main>', `<main id="app" data-ssr="${esc(symbol)}">${body}</main>`);
  return new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=1800, stale-while-revalidate=86400" } });
};

export const config = { path: "/s/:symbol" };
