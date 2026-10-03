"""Run the full study:  python -m investing.volstudy [--fetch]"""

import sys

import pandas as pd

from investing.volstudy import data, study_decomp, study_fit, study_forecast, study_iv, study_live, study_reversion, study_street

pd.set_option("display.width", 220)

if "--fetch" in sys.argv or not list(data.CACHE.glob("px_*.json")):
    data.fetch_all()
    for idx in [*data.CBOE_IV, "VIX"]:
        data.cboe_iv(idx)

print("== Part 1: decomposition by sector ==")
print(study_decomp.run()[1].round(2).to_string())
for h in (21, 63):
    print(f"== Part 2: OOS forecast, h={h} ==")
    print(study_forecast.run(h)[0].round(3).to_string())
print("== Part 3: CBOE implied-vol backtest ==")
_, rules, regs, per_name = study_iv.run()
print(per_name.round(3).to_string()); print(rules.round(3).to_string()); print(regs.round(3).to_string())
print("== Part 4: multiple-vol mean reversion ==")
print(study_reversion.run().round(3).to_string())
snaps = sorted(study_live.SNAPSHOTS.glob("ibkr_iv_snapshot_*.csv"))
if snaps:
    print(f"== Part 5: live cross-section ({snaps[-1].name}) ==")
    print(study_live.run(str(snaps[-1])).round(3).to_string(index=False))
print("== Part 6: street (consensus-basis) EPS decomposition and earnings response ==")
allrow, _, erc = study_street.run()
print(allrow.round(3).to_string()); print(erc.round(3).to_string())
print("== Part 7: options vs valuation fit cards ==")
cards, cboe = study_fit.run()
print(cards.round(3).to_string(index=False)); print(cboe.round(3).to_string())
