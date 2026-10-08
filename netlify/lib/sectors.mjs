// Sector taxonomy: GICS-style sectors with AI-related names broken out into the
// five layers of the AI stack (energy, chips, infrastructure, models, applications).
// A company can sit in more than one AI layer; a company in any AI layer is removed
// from its GICS sector. The GICS sectors hold the S&P 500; the AI layers are curated and
// include non-US names (TSM, ASML, ARM) where a layer needs them.
import { cached } from "./store.mjs";
import { fmpSoft } from "./fmp.mjs";

export const AI_LAYERS = [
  { id: "ai-energy", layer: 1, name: { ja: "AI 第1層：エネルギー", en: "AI layer 1: Energy", "zh-TW": "AI 第1層：能源" }, desc: { ja: "データセンターに電力を供給する発電・電力設備", en: "Power generation and electrical equipment feeding AI data centers", "zh-TW": "供應資料中心電力的發電與電力設備" }, members: ["VST", "CEG", "GEV", "NEE", "ETN", "SO", "DUK"] },
  { id: "ai-chips", layer: 2, name: { ja: "AI 第2層：半導体", en: "AI layer 2: Chips", "zh-TW": "AI 第2層：晶片" }, desc: { ja: "アクセラレータ、メモリ、製造装置、ファウンドリ", en: "Accelerators, memory, equipment and foundry", "zh-TW": "加速器、記憶體、設備與晶圓代工" }, members: ["NVDA", "AMD", "AVGO", "TSM", "ASML", "MU", "INTC", "QCOM", "TXN", "ARM"] },
  { id: "ai-infra", layer: 3, name: { ja: "AI 第3層：インフラ", en: "AI layer 3: Infrastructure", "zh-TW": "AI 第3層：基礎設施" }, desc: { ja: "クラウド、サーバー、ネットワーク、データセンター設備", en: "Cloud platforms, servers, networking and data-center equipment", "zh-TW": "雲端平台、伺服器、網路與資料中心設備" }, members: ["MSFT", "AMZN", "GOOGL", "ORCL", "DELL", "SMCI", "VRT", "ANET", "CSCO", "IBM"] },
  { id: "ai-models", layer: 4, name: { ja: "AI 第4層：モデル", en: "AI layer 4: Models", "zh-TW": "AI 第4層：模型" }, desc: { ja: "基盤モデルの開発者と主要出資者（上場企業）", en: "Foundation-model developers and their listed backers", "zh-TW": "基礎模型開發者與其上市投資方" }, members: ["GOOGL", "META", "MSFT", "AMZN"] },
  { id: "ai-apps", layer: 5, name: { ja: "AI 第5層：アプリケーション", en: "AI layer 5: Applications", "zh-TW": "AI 第5層：應用" }, desc: { ja: "AIを組み込んだソフトウェア、エージェント、自動運転・ロボティクス", en: "AI-native software, agents, autonomy and robotics", "zh-TW": "AI 軟體、代理程式、自駕與機器人" }, members: ["PLTR", "NOW", "CRM", "ADBE", "INTU", "TSLA", "UBER", "ACN"] },
];

export const AI_STACK = { id: "ai", name: { ja: "AIスタック（5層ケーキ）", en: "The AI stack (five-layer cake)", "zh-TW": "AI 堆疊（五層蛋糕）" }, desc: { ja: "エネルギー、半導体、インフラ、モデル、アプリケーションの5層で見るAI産業全体", en: "The whole AI industry seen as five layers: energy, chips, infrastructure, models, applications", "zh-TW": "以能源、晶片、基礎設施、模型、應用五層檢視整個 AI 產業" } };

// GICS-style sectors. Members are the current S&P 500 constituents (Financial Modeling
// Prep's list, refreshed daily) grouped by FMP's sector field, minus every AI-layer name.
export const GICS = [
  { id: "tech", fmp: ["Technology"], name: { ja: "情報技術（AI除く）", en: "Information Technology (ex-AI)", "zh-TW": "資訊科技（不含AI）" } },
  { id: "comm", fmp: ["Communication Services"], name: { ja: "コミュニケーション・サービス（AI除く）", en: "Communication Services (ex-AI)", "zh-TW": "通訊服務（不含AI）" } },
  { id: "discretionary", fmp: ["Consumer Cyclical"], name: { ja: "一般消費財（AI除く）", en: "Consumer Discretionary (ex-AI)", "zh-TW": "非必需消費（不含AI）" } },
  { id: "staples", fmp: ["Consumer Defensive"], name: { ja: "生活必需品", en: "Consumer Staples", "zh-TW": "必需消費" } },
  { id: "health", fmp: ["Healthcare"], name: { ja: "ヘルスケア", en: "Health Care", "zh-TW": "醫療保健" } },
  { id: "financials", fmp: ["Financial Services"], name: { ja: "金融", en: "Financials", "zh-TW": "金融" } },
  { id: "industrials", fmp: ["Industrials"], name: { ja: "資本財・サービス（AI除く）", en: "Industrials (ex-AI)", "zh-TW": "工業（不含AI）" } },
  { id: "energy", fmp: ["Energy"], name: { ja: "エネルギー", en: "Energy", "zh-TW": "能源" } },
  { id: "materials", fmp: ["Basic Materials"], name: { ja: "素材", en: "Materials", "zh-TW": "原材料" } },
  { id: "utilities", fmp: ["Utilities"], name: { ja: "公益事業（AI除く）", en: "Utilities (ex-AI)", "zh-TW": "公用事業（不含AI）" } },
  { id: "realestate", fmp: ["Real Estate"], name: { ja: "不動産", en: "Real Estate", "zh-TW": "不動產" } },
];

const norm = (x) => String(x || "").toUpperCase().replace(/\./g, "-");

/** S&P 500 constituents by FMP sector, cached for a day. */
export async function sp500BySector() {
  return cached("sp500-sectors", 24 * 3600, async () => {
    const list = await fmpSoft("sp500-constituent", {});
    const out = {};
    for (const c of Array.isArray(list) ? list : []) if (c.symbol) (out[c.sector || "Other"] ||= []).push(norm(c.symbol));
    if (!Object.keys(out).length) throw new Error("empty S&P 500 list");
    return out;
  }, { version: "1" });
}

/** The AI layers and the whole stack (static), followed by the S&P 500 GICS sectors (fetched). */
export async function allSectors() {
  const aiNames = new Set(AI_LAYERS.flatMap((l) => l.members));
  let bySector = {};
  try { bySector = await sp500BySector(); } catch (e) { console.warn("S&P 500 list unavailable:", e.message); }
  return [{ ...AI_STACK, group: "ai", members: [...aiNames], layers: AI_LAYERS.map((l) => ({ id: l.id, layer: l.layer, name: l.name, members: l.members })) },
    ...AI_LAYERS.map((l) => ({ ...l, group: "ai" })),
    ...GICS.map((g) => ({ ...g, group: "gics", members: [...new Set(g.fmp.flatMap((f) => bySector[f] || []))].filter((sym) => !aiNames.has(sym)) })).filter((g) => g.members.length)];
}

export async function sectorById(id) {
  return (await allSectors()).find((s) => s.id === id) || null;
}

/** The curated AI names (the S&P 500 part of the universe comes from the index list itself). */
export function sectorSymbols() {
  return [...new Set(AI_LAYERS.flatMap((l) => l.members))];
}

export async function sectorsOf(symbol) {
  const sym = norm(symbol);
  return (await allSectors()).filter((s) => s.id !== "ai" && s.members.includes(sym)).map((s) => ({ id: s.id, name: s.name, group: s.group }));
}
