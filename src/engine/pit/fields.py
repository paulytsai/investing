"""Canonical field names and the FMP / J-Quants → canonical mappings (first key with a value wins)."""
from __future__ import annotations

# statement → canonical field → candidate source keys (FMP /stable)
FMP_FIELDS: dict[str, dict[str, list[str]]] = {
    "income": {
        "revenue": ["revenue"],
        "cost_of_revenue": ["costOfRevenue"],
        "gross_profit": ["grossProfit"],
        "rd_expense": ["researchAndDevelopmentExpenses"],
        "sga_expense": ["sellingGeneralAndAdministrativeExpenses"],
        "operating_income": ["operatingIncome"],
        "interest_expense": ["interestExpense"],
        "pretax_income": ["incomeBeforeTax"],
        "net_income": ["netIncome"],
        "eps_diluted": ["epsDiluted", "eps"],
        "shares_diluted": ["weightedAverageShsOutDil", "weightedAverageShsOut"],
        "dep_amort": ["depreciationAndAmortization"],
        "ebitda": ["ebitda"],
    },
    "balance": {
        "total_assets": ["totalAssets"],
        "total_equity": ["totalStockholdersEquity", "totalEquity"],
        "cash_st_inv": ["cashAndShortTermInvestments", "cashAndCashEquivalents"],
        "total_debt": ["totalDebt"],
        "current_assets": ["totalCurrentAssets"],
        "current_liabilities": ["totalCurrentLiabilities"],
        "receivables": ["netReceivables", "accountsReceivables"],
        "inventory": ["inventory"],
        "goodwill_intangibles": ["goodwillAndIntangibleAssets"],
    },
    "cashflow": {
        "ocf": ["operatingCashFlow", "netCashProvidedByOperatingActivities"],
        "capex": ["capitalExpenditure"],
        "fcf": ["freeCashFlow"],
        "dividends_paid": ["netDividendsPaid", "commonDividendsPaid", "dividendsPaid"],
        "buybacks": ["commonStockRepurchased"],
        "debt_issued_net": ["netDebtIssuance"],
        "stock_issued_net": ["netStockIssuance", "netCommonStockIssuance"],
    },
}

FLOW_FIELDS = {
    *FMP_FIELDS["income"].keys(),
    *FMP_FIELDS["cashflow"].keys(),
    "cfi", "cff", "ordinary_income",   # J-Quants-only flows (決算短信)
}
NON_ADDITIVE = {"shares_diluted"}     # a weighted share count is a level: TTM takes the latest quarter, never a 4-quarter sum
FLOW_FIELDS -= NON_ADDITIVE
# per-share figures that must be restated to today's share basis when a split happens after the period end
PER_SHARE_FIELDS = {"eps_diluted", "bps", "dps_actual", "dps_forecast", "forecast_eps"}
STOCK_FIELDS = set(FMP_FIELDS["balance"].keys())

# J-Quants fins/summary (決算短信) → canonical. Cumulative YTD flows; de-cumulated in jp_fundamentals.
JQ_FIELDS: dict[str, str] = {
    "Sales": "revenue",
    "OP": "operating_income",
    "OdP": "ordinary_income",
    "NP": "net_income",
    "EPS": "eps_diluted",   # basic EPS; DEPS is diluted when present
    "TA": "total_assets",
    "Eq": "total_equity",
    "BPS": "bps",
    "CFO": "ocf",
    "CFI": "cfi",
    "CFF": "cff",
    "CashEq": "cash_st_inv",
    "ShOutFY": "shares_out",
    "DivAnn": "dps_actual",
    "FDivAnn": "dps_forecast",
    "FSales": "forecast_revenue",
    "FOP": "forecast_op",
    "FEPS": "forecast_eps",
}


def first_value(row: dict, keys: list[str]):
    for k in keys:
        v = row.get(k)
        if v not in (None, "", "None"):
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
    return None
