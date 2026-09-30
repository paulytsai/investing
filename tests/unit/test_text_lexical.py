from engine.text.lexical import counts, extract, net_scores


def test_lexical_hits_carry_quotes_and_rule_ids():
    t = ("We are sold out through next year and backlog grew 40% to a record. We raised our full-year guidance. "
         "Price increases stuck across the portfolio. We remain the number one supplier with share gains in every region. "
         "Management identified a material weakness in internal control. One customer accounted for 35% of revenue.")
    hits = extract(t)
    cats = {h.category for h in hits}
    assert {"demand_up", "guidance_up", "pricing_up", "leadership", "red_flag", "concentration"} <= cats
    h = next(x for x in hits if x.category == "guidance_up")
    assert "raised our full-year guidance" in h.quote and h.rule_id == "F-17" and h.direction == 1
    c = counts(hits)
    s = net_scores(c, words=2000)
    assert s["text_demand"] > 0 and s["text_guidance"] > 0 and s["text_red_flags"] > 0 and s["text_pricing"] > 0


def test_negative_signals_net_out():
    t = "Backlog declined as customers pushed out orders amid destocking; we lowered our outlook for the year and saw price erosion."
    s = net_scores(counts(extract(t)), words=2000)
    assert s["text_demand"] < 0 and s["text_guidance"] < 0 and s["text_pricing"] < 0
