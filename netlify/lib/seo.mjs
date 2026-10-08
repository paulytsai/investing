// Site metadata shared by the build step (index.html head), the server-rendered
// ticker pages and the sitemap. Everything is derived from the brand and locale.
import { cfg } from "./config.mjs";

export const CREATOR = {
  name: "Paul Tsai", nameJa: "ポール・サイ", url: "https://paultsai.net", image: "/img/paul-tsai.jpg",
  sameAs: ["https://paultsai.net", "https://diamond.jp/zai/category/k-paul"],
  jobTitle: { ja: "元フィデリティ投信 調査部長・個人投資家", en: "Former head of research, Fidelity Investments Japan; independent investor", "zh-TW": "前富達投信研究部主管・獨立投資人" },
};

export function siteMeta(locale) {
  const b = cfg.brand();
  const loc = locale || cfg.defaultLocale();
  const url = (cfg.siteUrl() || "https://kabukaizu.com").replace(/\/$/, "");
  const copy = {
    ja: { title: `${b.name} | 米国株アルマナック — 米国株を1ページで`, description: `${b.name}は米国上場企業の業績・財務・バリュエーション・株主・役員を1ページにまとめた米国株アルマナック。EDGARの公開財務情報と決算説明会のトランスクリプトをAIが読み込み、長期トレンド、直近動向、強気・弱気シナリオを日本語で要約します。7日間無料。`, tagline: "米国株という大海原の、あなたの水先案内人。" },
    en: { title: `${b.name} | US Stock Almanac — any US stock on one page`, description: `${b.name} is a US stock almanac: results, financials, valuation, holders and officers for any US-listed company on one page, with AI digests of EDGAR filings and earnings-call transcripts: long-term trend, recent quarters, bull and bear cases. 7-day free trial.`, tagline: "Your pilot guide for the blue ocean of US stocks." },
    "zh-TW": { title: `${b.name} | 美股年鑑 — 一頁看懂任何美股`, description: `${b.name} 是美股年鑑：任何美國上市公司的業績、財務、估值、股東與經營層一頁看完。AI 讀取 EDGAR 公開財務資料與財報電話會議逐字稿，整理出長期趨勢、近期動態與多空論點。免費試用 7 天。`, tagline: "引領您航向美股藍海的領航指南。" },
  }[loc] || null;
  const c = copy || { title: `${b.name} | US Stock Almanac`, description: "", tagline: "" };
  return { brand: b, locale: loc, url, lang: loc, title: c.title, description: c.description, tagline: c.tagline, ogImage: `${url}/img/wave.jpg`, price: cfg.lemon().priceLabel, locales: cfg.locales() };
}

export function siteJsonLd(m) {
  return [
    { "@context": "https://schema.org", "@type": "WebSite", name: m.brand.name, alternateName: `${m.brand.name} US Stock Almanac`, url: m.url, inLanguage: m.locales, description: m.description },
    { "@context": "https://schema.org", "@type": "SoftwareApplication", name: m.brand.name, applicationCategory: "FinanceApplication", operatingSystem: "Web", url: m.url, description: m.description, image: m.ogImage, offers: { "@type": "Offer", price: "10", priceCurrency: "USD", description: "Monthly subscription, 7-day free trial" }, author: { "@type": "Person", name: CREATOR.name, url: CREATOR.url } },
    { "@context": "https://schema.org", "@type": "Person", name: CREATOR.name, alternateName: CREATOR.nameJa, url: CREATOR.url, image: `${m.url}${CREATOR.image}`, jobTitle: CREATOR.jobTitle[m.locale] || CREATOR.jobTitle.en, sameAs: CREATOR.sameAs, alumniOf: ["University of California, Los Angeles", "Carnegie Mellon University"], worksFor: { "@type": "Organization", name: m.brand.name, url: m.url } },
  ];
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Rewrite the <head> of the static shell for a page: title, description, canonical, Open Graph, JSON-LD. */
export function applyHead(html, { title, description, canonical, lang, jsonLd, ogImage, noindex }) {
  const ld = (jsonLd || []).map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`).join("\n  ");
  const head = `<title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  ${noindex ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index,follow,max-image-preview:large">'}
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${esc(ogImage)}">
  <meta name="twitter:card" content="summary_large_image">
  ${ld}`;
  // Strip any tags from an earlier application (the static shell is already stamped at build time).
  const stripped = html
    .replace(/\s*<meta name="robots"[^>]*>/g, "")
    .replace(/\s*<link rel="canonical"[^>]*>/g, "")
    .replace(/\s*<meta (?:property="og:|name="twitter:)[^>]*>/g, "")
    .replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "");
  return stripped
    .replace(/<html lang="[^"]*">/, `<html lang="${esc(lang)}">`)
    .replace(/<title>[\s\S]*?<\/title>\s*<meta name="description"[^>]*>/, head);
}
