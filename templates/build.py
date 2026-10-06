"""Assemble the published page: inline src/engine.js and the translations into src/page.html.

    python templates/build.py   ->  templates/stock_template.html

The translations live in src/i18n/{ja,zh-Hant}.json, keyed by the English text.
"""
import json
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
(here / "stock_template.html").write_text(page)
print("wrote", here / "stock_template.html")
