// Sector taxonomy: GICS-style sectors with AI-related names broken out into the
// five layers of the AI stack (energy, chips, infrastructure, models, applications).
// A company can sit in more than one AI layer; a company in any AI layer is removed
// from its GICS sector. Names outside the S&P 100 are included where a layer needs them.

export const AI_LAYERS = [
  { id: "ai-energy", layer: 1, name: { ja: "AI 第1層：エネルギー", en: "AI layer 1: Energy", "zh-TW": "AI 第1層：能源" }, desc: { ja: "データセンターに電力を供給する発電・電力設備", en: "Power generation and electrical equipment feeding AI data centers", "zh-TW": "供應資料中心電力的發電與電力設備" }, members: ["VST", "CEG", "GEV", "NEE", "ETN", "SO", "DUK"] },
  { id: "ai-chips", layer: 2, name: { ja: "AI 第2層：半導体", en: "AI layer 2: Chips", "zh-TW": "AI 第2層：晶片" }, desc: { ja: "アクセラレータ、メモリ、製造装置、ファウンドリ", en: "Accelerators, memory, equipment and foundry", "zh-TW": "加速器、記憶體、設備與晶圓代工" }, members: ["NVDA", "AMD", "AVGO", "TSM", "ASML", "MU", "INTC", "QCOM", "TXN", "ARM"] },
  { id: "ai-infra", layer: 3, name: { ja: "AI 第3層：インフラ", en: "AI layer 3: Infrastructure", "zh-TW": "AI 第3層：基礎設施" }, desc: { ja: "クラウド、サーバー、ネットワーク、データセンター設備", en: "Cloud platforms, servers, networking and data-center equipment", "zh-TW": "雲端平台、伺服器、網路與資料中心設備" }, members: ["MSFT", "AMZN", "GOOGL", "ORCL", "DELL", "SMCI", "VRT", "ANET", "CSCO", "IBM"] },
  { id: "ai-models", layer: 4, name: { ja: "AI 第4層：モデル", en: "AI layer 4: Models", "zh-TW": "AI 第4層：模型" }, desc: { ja: "基盤モデルの開発者と主要出資者（上場企業）", en: "Foundation-model developers and their listed backers", "zh-TW": "基礎模型開發者與其上市投資方" }, members: ["GOOGL", "META", "MSFT", "AMZN"] },
  { id: "ai-apps", layer: 5, name: { ja: "AI 第5層：アプリケーション", en: "AI layer 5: Applications", "zh-TW": "AI 第5層：應用" }, desc: { ja: "AIを組み込んだソフトウェア、エージェント、自動運転・ロボティクス", en: "AI-native software, agents, autonomy and robotics", "zh-TW": "AI 軟體、代理程式、自駕與機器人" }, members: ["PLTR", "NOW", "CRM", "ADBE", "INTU", "TSLA", "UBER", "ACN"] },
];

export const AI_STACK = { id: "ai", name: { ja: "AIスタック（5層ケーキ）", en: "The AI stack (five-layer cake)", "zh-TW": "AI 堆疊（五層蛋糕）" }, desc: { ja: "エネルギー、半導体、インフラ、モデル、アプリケーションの5層で見るAI産業全体", en: "The whole AI industry seen as five layers: energy, chips, infrastructure, models, applications", "zh-TW": "以能源、晶片、基礎設施、模型、應用五層檢視整個 AI 產業" } };

export const GICS = [
  { id: "tech", name: { ja: "情報技術（AI除く）", en: "Information Technology (ex-AI)", "zh-TW": "資訊科技（不含AI）" }, members: ["AAPL"] },
  { id: "comm", name: { ja: "コミュニケーション・サービス（AI除く）", en: "Communication Services (ex-AI)", "zh-TW": "通訊服務（不含AI）" }, members: ["NFLX", "DIS", "CMCSA", "CHTR", "T", "VZ", "TMUS"] },
  { id: "discretionary", name: { ja: "一般消費財", en: "Consumer Discretionary", "zh-TW": "非必需消費" }, members: ["HD", "MCD", "LOW", "NKE", "SBUX", "TGT", "BKNG", "GM"] },
  { id: "staples", name: { ja: "生活必需品", en: "Consumer Staples", "zh-TW": "必需消費" }, members: ["WMT", "COST", "PG", "KO", "PEP", "PM", "MO", "MDLZ", "CL"] },
  { id: "health", name: { ja: "ヘルスケア", en: "Health Care", "zh-TW": "醫療保健" }, members: ["LLY", "UNH", "JNJ", "ABBV", "MRK", "TMO", "ABT", "ISRG", "DHR", "AMGN", "PFE", "GILD", "BMY", "MDT", "CVS"] },
  { id: "financials", name: { ja: "金融", en: "Financials", "zh-TW": "金融" }, members: ["BRK-B", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "AXP", "C", "SCHW", "BLK", "PYPL", "USB", "BK", "COF", "MET", "AIG"] },
  { id: "industrials", name: { ja: "資本財・サービス", en: "Industrials", "zh-TW": "工業" }, members: ["GE", "CAT", "RTX", "HON", "UNP", "BA", "DE", "LMT", "UPS", "GD", "MMM", "EMR", "FDX"] },
  { id: "energy", name: { ja: "エネルギー", en: "Energy", "zh-TW": "能源" }, members: ["XOM", "CVX", "COP"] },
  { id: "materials", name: { ja: "素材", en: "Materials", "zh-TW": "原材料" }, members: ["LIN"] },
  { id: "utilities", name: { ja: "公益事業（AI除く）", en: "Utilities (ex-AI)", "zh-TW": "公用事業（不含AI）" }, members: [] },
  { id: "realestate", name: { ja: "不動産", en: "Real Estate", "zh-TW": "不動產" }, members: ["AMT", "SPG"] },
];

export function allSectors() {
  return [{ ...AI_STACK, group: "ai", members: [...new Set(AI_LAYERS.flatMap((l) => l.members))], layers: AI_LAYERS.map((l) => ({ id: l.id, layer: l.layer, name: l.name, members: l.members })) },
    ...AI_LAYERS.map((l) => ({ ...l, group: "ai" })),
    ...GICS.filter((g) => g.members.length).map((g) => ({ ...g, group: "gics" }))];
}

export function sectorById(id) {
  return allSectors().find((s) => s.id === id) || null;
}

/** Every symbol any sector refers to (for the warmer and the sitemap). */
export function sectorSymbols() {
  return [...new Set(allSectors().flatMap((s) => s.members))];
}

export function sectorsOf(symbol) {
  const sym = String(symbol).toUpperCase();
  return allSectors().filter((s) => s.id !== "ai" && s.members.includes(sym)).map((s) => ({ id: s.id, name: s.name, group: s.group }));
}
