"""Assemble the published page: inline src/engine.js into src/page.html.

    python templates/build.py   ->  templates/stock_template.html
"""
from pathlib import Path

here = Path(__file__).parent
page = (here / "src" / "page.html").read_text()
engine = (here / "src" / "engine.js").read_text()
assert "/*__ENGINE__*/" in page
(here / "stock_template.html").write_text(page.replace("/*__ENGINE__*/", engine))
print("wrote", here / "stock_template.html")
