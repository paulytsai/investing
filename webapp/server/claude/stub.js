// Stub answers for running without ANTHROPIC_API_KEY. They are labelled as stubs and carry no numbers, so nothing
// they return can be mistaken for data: JSON sites come back empty, text sites say plainly what happened.
const NOTE_EN = "[Stub mode: Claude isn't connected on this server (no ANTHROPIC_API_KEY), so this is placeholder text, not analysis.]";
const NOTE = {
  ja: "［スタブモード：このサーバーには Claude が接続されていません（ANTHROPIC_API_KEY が未設定）。これは翻訳ではなく、動作確認用の仮の文章です。］",
  zh: "［模擬模式：此伺服器尚未連接 Claude（未設定 ANTHROPIC_API_KEY）。這不是翻譯，只是用來確認功能的暫時文字。］",
};

export function stubAnswer(site, content) {
  switch (site) {
    case "call.summary":
      return JSON.stringify({ call: "stub", date: null, topics: [NOTE_EN], qa_themes: [], guidance: [], swings: [], pricing_and_demand: [], costs_and_scale: [], one_offs: [], tone: "" });
    case "sec.segments":
    case "guide.release":
    case "guide.call":
      return JSON.stringify({ periods: [], quote: "" });
    case "notes.translate": {
      const first = content.split("\n")[0];
      const to = /into Japanese/.test(first) ? "ja" : /into Traditional Chinese/.test(first) ? "zh" : "en";
      if (to !== "en") return NOTE[to] + "\n\n" + NOTE[to];
      const at = content.lastIndexOf("NOTES:\n");
      return NOTE_EN + "\n\n" + (at >= 0 ? content.slice(at + 7) : "");
    }
    default:
      return NOTE_EN + "\n\nTHE STORY\nNo draft was written. Set ANTHROPIC_API_KEY in webapp/.env and restart the server to draft notes with Claude.";
  }
}
