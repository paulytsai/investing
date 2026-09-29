## §9 Configuration

`config/philosophy.yaml` is the single source of every parameter that the spec references as a backticked key (`namespace.key`). Code must read parameters from it and never hard-code them.

### 9.1 Structure

| Namespace | Leaves | `TBD(Paul)` | What it governs |
|---|---|---|---|
| `meta` | 3 | 0 | Spec version, as-of date, source corpus |
| `state` | 8 | 0 | Enums for `thesis_status`, `role`, `asset_type`, `bucket`, `shock_type` (§3.1) |
| `universe` | 39 | 9 | Mandate, reader access, theme-leader preference, asset-type tags, Japan/China/US scope |
| `research` | 97 | 22 | Required sources, gates G1–G6, valuation yardsticks, fund screens, AI dials, data-quality blocklist and date corrections |
| `entry` | 24 | 6 | Dip-buy conditions, staging, pre-commitment, post-shock waits |
| `hold` | 28 | 6 | Horizon, suppression rules, winner handling |
| `exit` | 33 | 15 | Thesis-break exits, cyclical exits, valuation trims, trade time stops, AI de-risk triggers |
| `sizing` | 17 | 8 | Initial size, max position, speculative caps, Kelly note, survival budget, leverage |
| `construction` | 39 | 22 | Sleeves and barbell, name counts, regional and theme caps, bonds |
| `rebalance` | 18 | 9 | Method, bands, oil trims, winner exceptions |
| `timing` | 40 | 15 | Technical and macro overlays, numeric-lines mode, sector tilts, premise register |
| `crisis` | 15 | 8 | Crisis flag, cooling-off, deployment, index markers |
| `fx` | 11 | 3 | Hedge policy, JP-reader overseas share, yen premise status |
| `cash` | 18 | 7 | Reader buffers, dry powder, parking instruments, hurdle source |
| `hedge` | 8 | 7 | Gold/bitcoin eligibility, insurance-sleeve bands, energy:gold ratio |
| `reporting` | 14 | 7 | Return basis, benchmark, annualization method, evaluation windows, number checks |
| `reader` | 37 | 4 | NISA/iDeCo/FIRE guidance parameters, bucket framework |
| `compliance` | 58 | 6 | Paul-only approvals, channel map, banned phrases, approved templates, fair disclosure, trading-restriction details |
| `monitor` | 3 | 1 | Checkpoint requirements and cadence |
| `macro` | 15 | 3 | Indicator thresholds, regime map, the VIX-level threshold (TBD) |
| **Total** | **525** | **158** | 7 values are `null` (none by design, e.g., no price stop-loss) |

### 9.2 Value conventions
- **Exact values** are copied from the sources. Each carries a trailing comment with rule IDs and a source note.
- **`TBD(Paul)`**: never stated. The engine must ALERT → GATE(Paul) and never guess (INV-5). **`TBD(Paul/Diamond)`** also needs Diamond's written rules (compliance).
- **`null`**: none by design, e.g., `exit.price_stop_loss: null` (INV-3).
- **Suggested defaults** from §10 appear only in comments (`# suggested default: …`). Promote one to a value only after Paul approves it, and record the D-ID in the change log.
- **⚠ flags (22)** mark places where a section's text states a different value from the config, or where sources disagree. Examples: target names 20–30 vs 10–20; three different sleeve lists; simple vs compound annualization. Resolve each through the D-ID named in the comment.

### 9.3 Maintenance rules
1. **Version every change.** Every edit bumps `meta.spec_version` and adds a `ConfigVersion` record (§8.4) listing the resolved D-IDs.
2. **Validate after every edit.** After each change, run the validator:
   - the file parses;
   - every backticked key in `docs/` resolves;
   - no key is orphaned;
   - the list of unresolved `TBD(Paul)` values is printed.
3. **Keep one canonical name per parameter.** Aliases from earlier drafts are listed as "aka" in comments.
4. **`research.gates` is a mapping.** Each gate G1–G6 has its outcome. The HARD pre-buy rule list is `research.gates.hard_pre_buy_rules`. Code must not treat `research.gates` as a list.
5. **Keep the `compliance.*` templates verbatim.** Paul must approve any Japanese template flagged [D] in §7 before it is used.

### 9.4 Full configuration file (`config/philosophy.yaml`)

```yaml
