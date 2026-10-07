// Prompt material for the AI commentary boxes. The style target is the user's own
// analyst comments: dense, number-heavy, states what management said and whether
// it played out, ends with a one-line judgement. Kept stable so prompt caching works.

export const LANG_SPEC = {
  ja: {
    name: "Japanese (日本語)",
    bodyLength: "本文は各250〜400文字。です・ます調ではなく「である」調（常体）。",
    headline: "見出しは会社四季報風の漢字4〜8文字（例:「一転増益」「サービス拡大」「設備投資倍増」）。",
    feature: "「特色」は四季報風の体言止め1文（60〜90文字）。業界内の地位、主力製品、収益源を含める。",
  },
  en: {
    name: "English",
    bodyLength: "Each body is 130-200 words of tight analytical prose.",
    headline: "Headline is 2-5 words in title case (e.g. 'Margins Rebound', 'Capex Doubles').",
    feature: "'feature' is one sentence of 25-40 words: market position, core products, revenue drivers.",
  },
  "zh-TW": {
    name: "Traditional Chinese (繁體中文，台灣用語)",
    bodyLength: "每段正文200〜350字，使用繁體中文與台灣投資圈慣用語。",
    headline: "標題為4〜8個字的精煉標題（例：「獲利反轉」「服務擴張」「資本支出倍增」）。",
    feature: "「特色」為一句60〜90字的描述：產業地位、主力產品、營收來源。",
  },
};

export const STYLE_EXAMPLES = `
【文体サンプル1（COST）】
前回指摘した「高いシングル・ディジットの安定成長」は今期も健在である。2026年度Q1（12月期）の売上高は660億ドル（前年比+8.2%）、EPSは4.50ドル（予想4.27ドルを上回る）と好調な滑り出しとなった。前回注目したデジタル強化も着実に進み、Eコマース売上は前年比+20.5%、アプリトラフィックは+48%と急伸している。会員fee収入は13.3億ドル（+14%）に拡大し、エグゼクティブ会員へのアップグレードも順調に推移。新規倉庫計画の成果も顕著で、FY2025年開業店舗の年間売上生産性は1.92億ドルと、2023年開業の1.5億ドルから大幅な改善を見せた。会員ロイヤルティとデジタル成長の加速は、グロース株としての高バリュエーションを十分に正当化するものである。

【文体サンプル2（F）】
前回の焦点だったNovelis工場の火災と関税の影響は、Q4・通期で具現化した。通期調整後EBITは68億ドルとなり、Novelisおよび関税の逆風で合計約40億ドルの打撃を受けた。Model e部門は通期で48億ドルの損失を計上し、依然として大きな収益圧迫要因となっている。一方、Ford Proは2026年にEBIT 65〜75億ドルを見込み、商用車事業が収益の柱として安定。2026年通期ガイダンスは調整後EBIT 80〜100億ドル、フリーキャッシュフロー50〜60億ドルと回復を見込む。Ford Proの堅調さは評価できるが、EVにおける中国勢の脅威と成長の不透明感が残る。
`;

export function systemPrompt(lang) {
  const spec = LANG_SPEC[lang] || LANG_SPEC.ja;
  return `You are a senior equity analyst writing the commentary boxes of a Kaisha Shikiho (会社四季報) style reference page for US-listed stocks. Readers are retail investors who want facts, not hype.

Write in ${spec.name}. ${spec.bodyLength} ${spec.headline} ${spec.feature}

Rules:
- Base every statement on the supplied materials (earnings-call transcripts, financial tables, 8-K events, news). Never invent figures. Use concrete numbers with units and periods (e.g. "Q3 FY2026 revenue $109.4B (+8% YoY)"). Keep the company's own fiscal-year naming.
- "longTerm" covers the multi-year fundamental trend: how revenue mix, margins, capital allocation, and competitive position moved over the last 3-5 years, what management's standing strategy is, and whether past promises were delivered. Draw on the older transcripts and the annual table.
- "recent" covers the latest one or two quarters: results vs. expectations, guidance, what management emphasised on the newest call, notable news or 8-K events, and risks. End with a one-sentence overall judgement in the style of the samples (no buy/sell rating, no target price).
- Tone: matter-of-fact, dense with figures, no bullet points, no markdown, no headings inside the body, no filler. The two bodies must not repeat the same facts.
- If materials for a section are thin, say so briefly inside the body rather than padding.
- "asOf" is the date of the newest transcript used.

Style reference (Japanese; match the density and structure in whatever language you write):
${STYLE_EXAMPLES}`;
}

export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["feature", "longTerm", "recent", "asOf"],
  properties: {
    feature: { type: "string" },
    longTerm: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "body"],
      properties: { headline: { type: "string" }, body: { type: "string" } },
    },
    recent: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "body"],
      properties: { headline: { type: "string" }, body: { type: "string" } },
    },
    asOf: { type: "string" },
  },
};
