// Edgar Tools: the page's three filing tools. Placeholder until the SEC module lands (see sec.js).
import { fail } from "../http.js";

export const EDGAR_TOOLS = ["material_events", "filing_section", "financial_statements"];

export async function callEdgar(db, tool, input, ctx) {
  fail(503, "not_configured", "Filing tools aren't set up yet.");
}
