"""`engine mcp`: the engine as tools for Claude Desktop / Claude Code (stdio MCP server). The conversational front-end for
evaluating Paul's own ideas: he types a name and a thesis, Claude calls these tools, and the answers come back as the
one-minute summary plus the path of the full page. Every tool is a thin wrapper over the library — no logic lives here."""
from __future__ import annotations

import json
from pathlib import Path


def build_server():
    try:
        from mcp.server.mcpserver import MCPServer
    except ImportError as e:  # pragma: no cover
        raise SystemExit('the MCP SDK is not installed: pip install -e ".[mcp]"') from e

    srv = MCPServer("paul-engine", instructions=(
        "Paul Tsai's investment engine. Use `evaluate` for names Paul brings (with his thesis and, if he gives them, his bull/base/bear "
        "scenarios); `ideas_latest` for what the sourcing engine sees now; `sector_view` for the sector calls and recommended bets; "
        "`size` for Kelly sizing; `drivers` for what moved a stock in the past. Answers are decision support for Paul, never orders."))

    @srv.tool(description="Evaluate Paul's names with the same engine that sources ideas: placement in the scored universe, sector view and bet, "
              "reasons for and against, Kelly size, and (narrate=true) a claim-by-claim verdict on his thesis. symbols: tickers or a file path. "
              "thesis: free text (or '## SYM' sections). scenarios: {SYM: {bull:{prob,return}, base:{...}, bear:{...}}} as decimals.")
    def evaluate(symbols: str, thesis: str = "", narrate: bool = False, scenarios: dict | None = None, as_of: str | None = None) -> dict:
        from .evaluate.run import run_evaluate
        from .reports.plain import summary_parts
        from .symbols import read_symbols, split_regions

        syms = read_symbols(symbols)
        out = {"names": [], "pages": []}
        for reg, ss in split_regions(syms).items():
            r = run_evaluate(ss, thesis=thesis or None, as_of=as_of, region=reg, narrate=narrate, scenarios=scenarios)
            if not r:
                continue
            out["pages"].append(str(Path(r["path"]) / "index.html"))
            for row in r["rows"]:
                c, p = row["c"], row["place"]
                sp = summary_parts(c, row["sector_call"], row["weight"])
                out["names"].append({"symbol": c.symbol, "summary": sp, "story": row.get("pitch"), "implied_growth": sp.get("implied_growth"),
                                     "valuation_cycle": (c.metrics.get("valuation_cycle") or {}).get("sentence"),
                                     "rank": p["rank"], "of": p["of"], "would_sourcing_choose_it": p["would_be_chosen"],
                                     "action": c.action, "idea_strength": c.idea_strength, "kelly_weight": row["weight"], "kelly": row["kelly"],
                                     "verdict": row["verdict"], "since_last_time": row["since"], "page": str(Path(r["path"]) / "ideas" / f"{c.symbol}.html")})
        return out

    @srv.tool(description="The latest full sourcing run: the chosen names with their one-minute summaries, the sector calls with recommended bets, "
              "and what changed since the previous run.")
    def ideas_latest() -> dict:
        from .reports.plain import summary_parts
        from .screen.diff import full_runs, latest_diff

        runs = full_runs()
        if not runs:
            return {"error": "no full sourcing run yet: run `engine ideas --top 20`"}
        run = runs[-1]
        cands = json.loads((run / "candidates.json").read_text())
        sizing = json.loads((run / "sizing.json").read_text())
        sectors = json.loads((run / "sectors.json").read_text())
        chosen = [c for c in cands if c["security_id"] in (sizing.get("weights") or {})]
        chosen.sort(key=lambda c: -(c.get("idea_strength") or 0))
        stories, sector_stories = {}, {}
        if (run / "sections.json").exists():
            for sec in json.loads((run / "sections.json").read_text()):
                sector_stories[sec["sector"]] = sec.get("pitch")
                for x in sec.get("stocks", []):
                    stories[x["symbol"]] = x.get("pitch")
        return {"as_of": json.loads((run / "run.json").read_text()).get("as_of"), "board": str(run / "board.html"),
                "names": [{"symbol": c["symbol"], "story": stories.get(c["symbol"]), "summary": summary_parts(c, sectors.get(c["theme_sector"]), sizing["weights"].get(c["security_id"]))} for c in chosen],
                "sector_stories": sector_stories,
                "sectors": [{"sector": v["label"], "stance": v["stance"], "bet": (v.get("bet") or {}).get("summary")} for v in sorted(sectors.values(), key=lambda v: -(v.get("score") or 0))],
                "since_last_run": latest_diff()}

    @srv.tool(description="The sector calls of the latest run: stance, score, the numbers behind the call in plain English, the recommended bet vs market weight, "
              "and where the sector's theme sits in its cycle. sector: a key such as ai_chips, energy, or 'all'.")
    def sector_view(sector: str = "all") -> dict:
        from .reports.plain import plain_sector_line
        from .screen.diff import full_runs

        runs = full_runs()
        if not runs:
            return {"error": "no full sourcing run yet"}
        sectors = json.loads((runs[-1] / "sectors.json").read_text())
        keys = list(sectors) if sector == "all" else [k for k in sectors if sector.lower() in (k, sectors[k]["label"].lower())]
        return {k: {"label": v["label"], "stance": v["stance"], "score": v["score"], "bet": v.get("bet"), "why": [plain_sector_line(x) for x in v["rationale"]]} for k, v in sectors.items() if k in keys}

    @srv.tool(description="Kelly sizing for a set of names (half Kelly, 15% cap, correlated names share one budget). scenarios as in evaluate.")
    def size(symbols: str, scenarios: dict | None = None, as_of: str | None = None) -> dict:
        from .config import Hypotheses
        from .screen.run import build_candidates, last_trading_day, size_positions
        from .symbols import read_symbols

        hyp = Hypotheses.load()
        d = last_trading_day(as_of)
        names = build_candidates(d, "US", hyp, read_symbols(symbols))
        s = size_positions(names, d, hyp, scenarios)
        return {"as_of": str(d.date()), "weights": {c.symbol: s["weights"].get(c.security_id) for c in names}, "cash": s["cash"],
                "per_name": {c.symbol: s["blocks"].get(c.security_id) for c in names}}

    @srv.tool(description="What moved a stock over the last ten years: the price phases with the earnings-vs-multiple decomposition and the events inside each.")
    def drivers(symbol: str) -> dict:
        from .drivers.run import run_drivers

        r = run_drivers(symbol.upper())
        return {"page": str(r.get("path")) if r else None, "phases": (r or {}).get("phases")}

    return srv


def main() -> None:
    build_server().run("stdio")
