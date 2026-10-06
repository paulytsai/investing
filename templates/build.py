"""Assemble the published page: inline src/engine.js and the translations into src/page.html.

    python templates/build.py         ->  templates/stock_template.html (the claude.ai artifact)
    python templates/build.py --web   ->  webapp/public/app.html + webapp/server/claude/prompts.default.json

The translations live in src/i18n/{ja,zh-Hant}.json, keyed by the English text. New user-visible text in
page.html goes through TR("...") and gets an entry in both files; anything missing shows in English.
The PDF export in Japanese or Chinese loads Noto Sans JP/TC (400 Regular, @expo-google-fonts 0.4.3), published
next to the page as fonts/NotoSansJP_400Regular.ttf and fonts/NotoSansTC_400Regular.ttf.
"""
import json
import sys
from pathlib import Path

here = Path(__file__).parent
page = (here / "src" / "page.html").read_text()
engine = (here / "src" / "engine.js").read_text()
assert "/*__ENGINE__*/" in page
page = page.replace("/*__ENGINE__*/", engine)
slot = "/*__I18N__*/ { ja: {}, zh: {} }"
if slot in page:
    dicts = {k: json.loads((here / "src" / "i18n" / f).read_text()) for k, f in (("ja", "ja.json"), ("zh", "zh-Hant.json"))}
    page = page.replace(slot, json.dumps(dicts, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/"))
    print(f"translations: {len(dicts['ja'])} ja, {len(dicts['zh'])} zh strings")
if "--web" not in sys.argv:
    (here / "stock_template.html").write_text(page)
    print("wrote", here / "stock_template.html")
else:
    # Web build: the same page as a full document for the web app, with the shim that stands in for the claude.ai
    # runtime loaded first (a classic, synchronous script, so window.claude exists before the page script runs),
    # and the page's Claude prompts exported as version 1 of the server's prompt registry.
    web = here.parent / "webapp"
    # wording that only makes sense inside claude.ai, with the web app's version (English source and dictionary
    # keys change together, so the translations still match)
    for a, b in (
        ("pulled live through your FMP connector", "pulled live from FMP"),
        ("FMPコネクタ経由でリアルタイムに取得しています", "FMPからリアルタイムに取得しています"),
        ("透過您的 FMP 連接器即時取得", "即時取自 FMP"),
        ("Drafting needs Claude, available when this page is opened in claude.ai.", "Drafting with Claude isn't included in your plan."),
        ("下書きにはClaudeが必要です。claude.aiでこのページを開くと利用できます。", "Claude による下書きは、ご利用のプランに含まれていません。"),
        ("草擬功能需要 Claude，在 claude.ai 中開啟此頁面即可使用。", "您目前的方案不含 Claude 草擬功能。"),
    ):
        assert a in page, "web wording: not found: " + a
        page = page.replace(a, b)
    doc = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
           '<script src="/shim.js"></script>\n</head>\n<body>\n' + page + '\n</body>\n</html>\n')
    (web / "public").mkdir(parents=True, exist_ok=True)
    (web / "public" / "app.html").write_text(doc)
    prompts = {}
    for name in ("CALL_PROMPT", "NOTES_SYSTEM", "NOTES_PROMPT", "SEC_PROMPT", "GUIDE_PROMPT", "GUIDE_CALL_PROMPT"):
        start = page.index("const %s = `" % name) + len("const %s = `" % name)
        end = page.index("`", start)
        body = page[start:end]
        assert "\\" not in body and "${" not in body, name + " needs template-literal unescaping"
        prompts[name] = body
    # the language suffix of the notes prompt and the translation template, evaluated from the page's own code, so
    # the server can check that a Claude request has exactly the page's shape
    import subprocess
    lines = page.split("\n")
    pick = lambda start: next(l for l in lines if l.strip().startswith(start)).strip()
    a = page.index("const NOTES_TR_PROMPT = ")
    tr_src = page[a:page.index("`;", a) + 2]
    js = (pick("const LANG_NAME = ") + "\n" + pick("const notesLang = ") + "\n" + tr_src + "\n"
          'const P = (k) => "\\u0001" + k + "\\u0001";\n'
          'console.log(JSON.stringify({ LANG_NAME, NOTES_LANG: { ja: notesLang("ja"), zh: notesLang("zh") },'
          ' NOTES_TR_TEMPLATE: NOTES_TR_PROMPT(P("FROM"), P("TO"), P("NAME"), P("TEXT")) }));')
    prompts.update(json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout))
    (web / "server" / "claude").mkdir(parents=True, exist_ok=True)
    (web / "server" / "claude" / "prompts.default.json").write_text(json.dumps(prompts, ensure_ascii=False, indent=1))
    print("wrote", web / "public" / "app.html", "and", web / "server" / "claude" / "prompts.default.json")
