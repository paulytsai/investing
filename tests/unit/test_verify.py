from engine.research.schemas import Checkpoint, Claim
from engine.research.verify import doc_ids, mark_free_text, verify_claim


def test_doc_ids_and_claim_verification():
    msgs = [{"role": "user", "content": [{"type": "text", "text": '<doc id="10-K filed 2025-10-31 Item 7" period="FY2025" source="EDGAR">x</doc>'}]}]
    ids = doc_ids(msgs)
    fr = {"roic_ttm": 0.25, "revenue_ttm": 1.2e9}
    ok = verify_claim(Claim(text="revenue 1.2B", value=1.2e9, source="FinancialRead.revenue_ttm"), ids, fr)
    assert ok.verified
    ok2 = verify_claim(Claim(text="ROIC 25%", value=25, source="FinancialRead.roic_ttm"), ids, fr)
    assert ok2.verified                      # percent form accepted
    bad = verify_claim(Claim(text="margin 40%", value=40, source="analyst note"), ids, fr)
    assert not bad.verified and bad.text.endswith("(unverified)")
    doc = verify_claim(Claim(text="segment share 29%", source="10-K filed 2025-10-31 Item 7"), ids, fr)
    assert doc.verified


def test_mark_free_text_flags_uncited_numbers():
    t, n = mark_free_text("Revenue grew 24% (FY2025, 10-K) while margins hit 40% and RPO reached $638B.")
    assert n == 2 and "40% (unverified)" in t and "$638B (unverified)" in t and "24% (FY2025" in t


def test_checkpoint_thresholds_never_invented():
    cp = Checkpoint(premise="x", kpi="y", source="z", bull_threshold="growth ≥ 30%", bear_threshold="TBD(Paul)")
    assert cp.bull_threshold == "TBD(Paul)"
    cp2 = Checkpoint(premise="APP", kpi="growth", source="10-Q", bull_threshold="≥ +46% with stable installs")
    assert cp2.bull_threshold.startswith("≥ +46%")
