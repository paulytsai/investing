# Industry and Company Analysis — reference framework

**Status.** A paraphrased working framework for Paul's own analysis, derived from Mars & Co training material (decks dated 2000),
supplied by Paul on 2026-10-03. The source is marked confidential and proprietary to Mars & Co: this file stays inside the private
repository, is never copied into reports or artifacts, and is cited by section number only. Tags in the text: SRC p.N (stated in the
source), INTERP (a reading of an ambiguous slide), ADAPT (added to make it computable or apply it to public companies).

**Where the engine implements it.**

| Module | Engine |
|---|---|
| §0.4 trend rules (log least squares, split at an inflection) | `frameworks/industry.py::log_trend_cagr`, `split_trend`; growth sentences in `research/story.py` |
| §3.6 profit pools, whale curve, product/brand map | `whale_curve`, `brand_map_imperative`; segment profit pools in `research/industry.py` from the 10-K segment note |
| §4 cost curves and slopes | `cost_curve`, `fit_slope` (Paul's inputs via `--industry-inputs`) |
| §5.1–5.4 competitor positions, derivative spine, gap bridge | `competitor_cost_position`, `derivative_spine`, `gap_bridge`; the margin gap vs the best peer by spine stage in `research/industry.py` |
| §5.5 performance-gap diagnosis | `performance_gap_diagnosis` |
| §6.2 cost histogram price band | `cost_histogram_price_band` (Paul's plant inputs) |
| §6.3–6.4 share line, market environments | `share_profit_line`, `market_environment`; the sector share line in the sector section |
| §7.1, 7.3, 7.5 demand levers, price zones, share gaps | `demand_lever_ranking`, `price_response_zones`, `volume_gap` (Paul's inputs) |
| §2, §10.3 battlefields, insight template | `IndustryRead` (Claude) in `research/industry.py` |
| §0.5 defaults | `config/hypotheses.yaml` → `industry:` |

---

# Industry and Company Analysis Framework

Derived from: Mars & Co training material bound as one PDF (173 pp). Content comes mainly from Strategic Cost Analysis à la Mars & Co (pp.48 to 91, plus pp.30 to 31) and Strategy Consulting à la Mars & Co (pp.92 to 170), with a few general analysis rules and two driver tables from Strategic Financial Analysis à la Mars & Co (pp.19, 36, 43 to 47). Decks dated 2000.

Scope: industry structure, competitive position, company cost economics, consumer demand, customers and market opportunities. Financial return analysis (ROCE, WACC, economic profit, cash flow and self-sustainability) is deliberately excluded.

Status: A paraphrased working framework for personal analytical use. The source is marked confidential and proprietary to Mars & Co; do not redistribute this file or the source.

Tags:SRC p.N stated in the source (PDF page)INTERP my reading of an ambiguous slideADAPT added, not in the source

## 0. Instructions for Claude Code

### 0.1 Purpose

Use this document as the specification for analysing an industry and the companies in it: which battlefields a business fights on, where it and its competitors gain or lose efficiency, what drives customer demand and pricing, how industry structure sets prices and profits, and where the market opportunities are.

### 0.2 Tags

| Tag | Meaning |
|---|---|
| SRC p.N | Stated in the source. N is the PDF page number (slide numbers restart in each deck). |
| INTERP | The source is ambiguous or only graphical; this is a reading of it. Treat as a revisable default. |
| ADAPT | Not in the source. Added to make the method computable or to apply it to public companies. |

### 0.3 Operating principles SRC p.95, p.96

- Build an undisputed, granular, quantified fact base before concluding. Every number traces to a source or an explicit assumption.

- Tailor the analysis; no cookie cutter templates.

- Aim at resource realignments: changes in scope, step changes in efficiency, offensive and defensive moves.

- Quantify "how high is high": set targets from the best demonstrated economics in the industry.

### 0.4 Hard rules

- Granular first, aggregate later. Cost and profit data are built at the finest cut available and re-aggregated into a handful of strategic segments at the end SRC p.55.

- Allocation quality. Prefer actual cost data, then objective physical parameters, then expert estimates; use volume or revenue keys only for small residual items SRC p.58.

- Triangulate. Bottom-up models of competitors must tie to known aggregates (headcount, syndicated volumes, routes, wage rates, plausible utilisation) SRC p.76.

- Structural vs operational. Classify every cost driver and every gap as structural (outside management control) or operational (closable) SRC p.68, p.115.

- Normalise before comparing. Remove non-economic items and mix effects before attributing gaps to efficiency SRC p.88, p.89.

- Weight by gap, not by cost share when choosing where to act (derivative spine) SRC p.77.

- Drivers interact. Net out interactions and sequence actions; never add up lever effects computed in isolation SRC p.31, p.72.

- Trends. Growth rates come from a least squares fit on the log of the values; if a series has an inflection, report two periods separately SRC p.45. Watch for discontinuities such as changes in consolidation perimeter SRC p.46.

- Explain shifts with a business event (portfolio change, new entrant, new channel, capacity addition) or flag them as unexplained SRC p.46, p.47.

- Disclosure limits. Results built from thin public disclosures may be only directionally correct; say so SRC p.43.

### 0.5 Default parameters

| Parameter | Default | Note |
|---|---|---|
| Sub-scale share index |  1.5 | INTERP axis printed "1:1.5" |
| High growth market | > 12% a year | SRC p.154 |
| Volume inelastic price zone | arc elasticity magnitude

### 0.6 Output contract

Every analysis returns: (a) the segmentation used, (b) the quantified findings by module, (c) structural vs operational classification of each gap or driver, (d) implications as resource realignments, (e) flags and caveats, (f) sources for every input. Output is diagnostic; it contains no trade instructions.

## 1. Framing the question

### 1.1 The assignment cube SRC p.99, p.102

Place any question on three axes:
- Competitive point of reference: internal, competitor specific, industry wide.
- Business perspective: operations, organisation (and finance, out of scope here).
- Strategic spine or scope: sourcing, manufacturing, sales and distribution, demand building, SG&A, portfolio of businesses.

And on the market side:
- Macro forces: market sizes and trends; external factors (technology, regulation); competitive intensity.
- Micro forces: customer segmentation (needs, buying behaviour, value); channel fundamentals.
- Client know-how: existing market vs new market.

### 1.2 The levers this framework looks for SRC p.96, p.98

| Lever | Examples |
|---|---|
| Changes in business scope | Prune or expand the portfolio; focus on the most promising products and customers; fix or exit products or customer segments; acquisitions or alliances; new market entry |
| Step changes in efficiency | Close specific gaps vs competitors; make or buy arbitrage; organisational shifts |
| Offensive and defensive moves | Focused pressure on competitors; protect areas of vulnerability |
| Targets | Quantify "how high is high" |

### 1.3 Assignment patterns SRC p.110 to 144

| Point of reference / focus | Typical question | Techniques |
|---|---|---|
| Internal, operations | Rip apart own economics; find key leverage points; mine the "grabs" | Strategic spine; derivative spine on internal benchmarks; optimisation modelling |
| Competitor specific, operations | Full competitor dissection; strengths and vulnerabilities; close gaps | Spine; derivative spine; competitive intelligence; estimation by triangulation |
| Competitor specific, sourcing | Sourcing competitiveness; supply chain; make or buy | Spine; competitive intelligence; inventory management; logistics optimisation |
| Internal, demand building | Go to market and channel strategy; marketing mix | Spine; image cost; conjoint analysis; prototypical operating environments; price elasticity |
| Industry wide | Industry price model; acquisition search; consolidation scenarios | Spine; cost histogram theory; dynamic modelling |
| Organisation | Organisational shift; benchmarking; goals vs structure | Decision rights over resources; change management; re-engineering |

Each case in the source follows situation → key approach → findings → outcome. Use the same structure for written conclusions.

## 2. Strategic segmentation SRC p.103 to 107

Knowing which battlefield a business fights on, and which key leverage points (key success factors) it has in each, is the core of strategy design.

- List candidate axes: product type, technology, customer, economics, distribution, competitors, geography.

- Tag each business family (or product line) by the competitors it meets, the technology it uses and the customers it serves.

- Group families that share the same pattern into one strategic segment SRC p.106.

- Describe each battlefield with a standard template SRC p.107:

| Attribute | What to record |
|---|---|
| Product definition | Standards based, proprietary, custom, service |
| Production volume | Small, medium, large |
| Typical operating set-up | Scale plant with subcontracting, integrated workshop, specialised plant |
| Customers | Few large accounts, many small scattered ones, one per product |
| Major customer requests | Quality, price, lead time, service, availability, range |
| Route to customer | Key account managers, direct sales force, distribution, sales engineers |

Expect a handful of battlefields. Example: hundreds of thousands of SKUs for thousands of customers collapsed into four product and customer families SRC p.103.

## 3. Company economics: the strategic spine

### 3.1 Goal SRC p.49

Identify where, and quantify how, the company and each competitor accumulate relative efficiencies in running the business.

### 3.2 The spine SRC p.50, p.53

- Organise the total cost of a delivered product or service around the full flow of activities that create and distribute it.

- An activity is a discrete stage governed by a predictable set of economic rules: physical (extruding aluminium, putting product on a shelf) or non-physical (advertising to create demand).

- Activities need not match the organisation chart; drawing their boundaries takes judgment across functions.

- Re-map the P&L from cost by nature (material, labour, burden, engineering, advertising, selling, admin) into activities, for example: product development → purchased materials → transformation (down to component and assembly steps, scrap, tooling, warranty) → demand building (brand, product family, product specific and co-op advertising) → selling (sales force, retail assistance, discounts) → logistics (warehousing, shipping, order processing, transport) → returns → G&A → operating profit by SKU and by customer.

### 3.3 Steps SRC p.51, p.54

- Build the spine: delineate the activity sequence; first allocation of cost; define the cube; fully cost each activity for each cell.

- Identify cost variables: what drives efficiency at each activity (Section 4).

- Quantify cost curves ("slopes") linking each variable to activity cost (Section 4).

- Determine competitor cost positions activity by activity (Section 5).

### 3.4 The cube SRC p.55, p.56

Cost every activity for sub-segments along product type × channel × geography. Other useful cuts: revenue stream (equipment, rental, supplies, service, financing), vertical market, customer size band. Keep it as granular as the data allows.

### 3.5 Allocation hierarchy SRC p.58

- Actual data captured by systems (labour and material by line and run).

- Objective physical parameters (time and motion, drop size).

- Expert estimates (plant engineers, R&D heads).

- Volume or revenue keys for small residual items only.

### 3.6 Profit pools inside the company SRC p.57, p.59, p.61 to 64

Once fully costed, rank units by operating margin with width proportional to revenue (a "whale curve") for SKUs, customers, geographies, verticals and customer size bands.
- A large share of SKUs is often unprofitable: in one case 40% of SKUs, about 30% of sales, losing money SRC p.57.
- Profitability can vary several fold by geography (metropolitan areas were more profitable in one case) and each vertical reaches its margin through a different cost stack SRC p.59, p.61.
- Customer bands with above average margins and low penetration are growth opportunities SRC p.62.

Product and brand maps SRC p.63, p.64: x = operating margin (or profit per unit), y = change in share (or volume growth), bubble = revenue (or volume), reference lines at portfolio averages. Imperatives:
| Region | Imperative |
|---|---|
| Profitable and growing | Drive profitable growth |
| Near break-even | Maintain or make profitable (depends on growth) |
| Profitable but declining | Stop the decline |
| Loss making | Find a radical solution or exit |

## 4. Cost drivers and slopes

### 4.1 Cost variables SRC p.66 to 68

- Cluster all factor costs (labour, capital, materials) for each activity to size its importance.

- Most activities have several drivers. A snack plant example tested: total plant scale, line scale, raw material quality, equipment age, package size, line run length, SKU run length, technology, capacity utilisation, wage rate. Changeover cost depended on run lengths; overhead on plant scale; bag overfill on line scale SRC p.67.

- Structural variables are largely outside the activity manager's control: location, scale, technology, factor costs. Operational variables are within it: organisation, run length, line speed, capacity utilisation. Control is a continuum SRC p.68.

### 4.2 Slopes SRC p.66, p.70

The slope of a cost curve is the multiplier applied to unit cost when the driver doubles.

```python
cost(x) = cost(x₀) × (x / x₀) ^ log₂(slope)
Fit:      ln(cost) = a + b·ln(x)     →    slope = 2^b

```

- Slope 75%: doubling run length cuts unit cost by 25% SRC p.70.

- Slope 95%: a purchased material whose cost falls 5% each time volume bought from one supplier doubles SRC p.66.

- Example slopes from one ice cream maker: capacity utilisation 62%, line efficiency 69%, plant scale 82%; cost against a complexity index was plotted on linear axes with no slope given SRC p.31.

- The steeper the slope (the lower the percentage), the more that driver matters for cost.

### 4.3 Estimating curves SRC p.71

Cross-section of similar plants or equipment; production records; time series for one unit; time and motion studies; engineering or financial simulation; experience from prior studies. Data availability dictates the method.

### 4.4 Uses SRC p.69

Focus management on the variable that matters most; quantify cost sharing between products; cost the addition or deletion of products; forecast future cost positions.

### 4.5 Interdependence: "mining the grabs" SRC p.31, p.72

Drivers interact. Cutting SKUs lowers volume and utilisation but also complexity; cutting lines raises utilisation but lowers scale; more inventory cover lowers complexity but raises inventory cost. Build an ordered action plan in which each step's effect is measured after the previous ones. The source example sequenced six actions (SKU cuts, line cuts, inventory cover, line management, scrap, forecast accuracy) worth about $8.4M together.

## 5. Competitor economics

### 5.1 Relative cost position from slopes SRC p.74

Isolate the cost variables, quantify the slopes, gather focused intelligence on competitors' driver values, then read each competitor's cost off the curves, activity by activity, and sum.

competitor_cost(activity) = client_cost(activity) × (competitor_driver / client_driver) ^ log₂(slope)

Slide illustration: slope 60%, client at 50K average run length and 2,500 per unit, competitor A at 35K, competitor B at 75K. ADAPT The formula gives about 3,250 and 1,855; the slide's 3,150 and 1,900 are illustrative.

### 5.2 Building competitor economics SRC p.75, p.76

| Spine stage | Information modelled | Typical sources |
|---|---|---|
| Purchased materials | Recipes; packaging specs; raw material costs; freight distances and mileage | Client R&D; suppliers; field interviews |
| Transformation | Plant layouts (building age and size, number of lines, products per line, staffing per line, wages and benefits); plant overhead headcount | Plant visits; equipment suppliers; permits and government filings; field interviews; local press; chambers of commerce |
| Distribution and selling | Warehouses (number, location, size, equipment, headcount); routes (market area, accounts per route, visit frequency, drop size by account type); driver activities | Warehouse and trade visits; equipment suppliers; permits; field interviews; client route sales reps |
| Demand building | Media spend; trade spend; promotion frequency; headcount | Syndicated media data; client route sales reps; field interviews |
| G&A | Headcount by function | Field interviews |

Approach: gather (prior files, interviews with people who know the competitor, extensive field work) → build bottom-up models → triangulate with known aggregates (employee counts, syndicated sales volumes, number of routes, regional wage rates, plausible capacity utilisation) → pressure test with people who know the business.

ADAPT Public-markets analogues: segment and product disclosures, plant and capacity data, permits, job postings, trade and customs data, supplier and customer disclosures, industry cost curve vendors, expert interviews within MNPI compliance rules.

### 5.3 Derivative spine: where the actionable gaps are SRC p.77

Weight activities by the cost gap between the least and most efficient competitor, not by their share of cost. Example: purchased materials 50% of cost, transformation 25%, overhead 25%; each shows a 100 per unit gap, so the actionable zones are 33/33/34. Transformation and overhead each rise from a quarter to a third of the focus, while purchased materials falls from half to a third.

### 5.4 Gap bridges SRC p.88 to 91, p.114 to 118

- Normalise to economic EBIT. Strip non-economic differences so the true gap is visible. In the source example these were export support, a favourable internal cost allocation and royalties; the economic gap was about $40M, of which only about $27M showed in reported EBIT, and about half the gap was structural (scale related). The client acted on the rest SRC p.88.

- Separate mix from like-for-like. Remove product mix and exceptional differences first; express gaps per standard unit and in total currency SRC p.89.

- Bridge by driver and spine stage, tagging each item closable or structural. Include the competitor's disadvantages too; a competitor's heavy organisation became an advantage for the client SRC p.88. A margin bridge from the low cost producer to the client split actionable items (utilisation, efficiency and spoilage, manning, labour rate, material usage) from structural ones (line speed, plant scale, logistics, price and mix, overhead) SRC p.115.

- Rank structural positions at a theoretical price limit: compute each player's margin at the theoretical price and 100% utilisation (cost histogram theory, Section 6.2) SRC p.116.

- Act and track. One action plan closed about 70% of a cost gap in two years (£37M to £12M) through simplification, scale, technology, supplier best practice, plant rationalisation, automation and removal of duplicated organisations; savings were reinvested to refocus and re-energise the product portfolio SRC p.90, p.91. A low cost producer's 5 point advantage from process technology was cut to 2 points by emulating it SRC p.114.

- If closable gaps cannot offset a structural disadvantage, exit or outsource the activity SRC p.118.

### 5.5 Diagnosing performance gaps: operational vs structural SRC p.36

| Gap | Operational drivers → solution orientation | Structural drivers → solution orientation |
|---|---|---|
| Slow volume growth | Lackluster market or share → focus the brand and channel portfolio; leverage latent brand equity; leverage marketplace P&L; step up investment in quality, pricing, advertising and merchandising | Mature market, mature share → create excitement; new products and extensions; new categories |
| Weak operating margin | Margin below what share and scale predict → rip apart internal economics (grow high margin areas; fix or exit low margin ones); rip apart competitor economics to close cost gaps | Low share or scale, weak brands, strong trade → acquisition, or a slow build |
| Poor asset utilisation | Low fixed asset or inventory turns → less asset intensive growth routes (product or channel mix, distributors, co-packers); sweat or sell assets (e.g. 24 hour operation); inventory reduction | Heavy goodwill; high receivables from trade practices; market pricing problems |

### 5.6 Competitor profit sanctuaries SRC p.79 to 82

Reverse engineer competitors' economics to the same granularity and rank their segments by margin (whale curves by brand, product, geography).
- Industry-wide operating profit by manufacturer brand shows which players make the money SRC p.79.
- A competitor often earns most of its profit in a few segments (in one case seven segments) and may run loss leaders elsewhere SRC p.80, p.81. These are its sanctuaries and its vulnerabilities.
- An industry plant cost curve (cost per ton against annual output) shows who the low cost producers are and where the client sits SRC p.82.

### 5.7 Offensive use of competitor economics SRC p.84 to 86

A dominant player under attack found the challenger was only a couple of share points from viability, made nearly all its profit in one regional niche, and relied on third-party distributors, of whom 10% carried 50% of sales; several distributors depended on one account for over half their revenue. Shifting from "carpet bombing" nationwide to "laser strikes" on the key distributors, the vulnerable sub-scale distributors and the profit niche eroded the challenger's share, pushed key distributors out, and led to its exit, while the defender's own results improved through better targeted demand building spend.

### 5.8 Operating benchmark KPIs (distribution example) SRC p.119

Sales per route, per account, per tractor, per square foot and per case; warehouse space and warehouse capital per square foot; cases per square foot; average route miles; number of accounts; average drop size; cases per mile; miles and routes per tractor; gross profit per case and per route; SKU count.

## 6. Industry structure and pricing

### 6.1 What drives industry economics SRC p.19

| Group | Actionable? | Drivers | Mainly affects |
|---|---|---|---|
| Market fundamentals | Usually not | Market growth and segment maturity; competitive intensity (Herfindahl index) and entry barriers; differentiation potential; price elasticity | Margins and growth |
| Competitive position | Yes | Position on key purchase criteria; differentiation and relative price (premium or discount); cost competitiveness; relative time to market | Margins and growth |
| Supply chain management | Yes | Share of value added controlled; asset intensity of that value added; inventory management; asset utilisation | Asset intensity |

### 6.2 Cost histograms and industry pricing SRC p.132 to 135

For commodity and capacity driven industries:
- Sort plants by total delivered cost including a return on capital and lay them out along cumulative delivered capacity (an industry cost curve). Draw local market demand.
- The theoretical price lies in a band between the minimum price of the last entrant (the highest cost plant still needed to meet demand) and the minimum price of the first loser (the next plant, left out).
- Dynamic version: supply points (location, capacity, cost) × demand points (location, tons) → delivered cash cost for every plant-market pair (about 90,000 pairs in the source case) → which plants supply each market, by which route, how many tons, at what price range SRC p.134.
- Use it to simulate capacity additions, alliances and acquisitions; value each scenario as the NPV of earnings for each player SRC p.135. In the source case the industry did price according to the histogram, some expansion scenarios were very damaging, and acquiring the key competitor protected profitability while controlling its expansion SRC p.132.

### 6.3 Relative share and profitability SRC p.153

Relative share can be a clear driver of profit: system return on sales rose steadily with the volume ratio to the main competitor, plotted on a log scale. Fit ROS = a + b·ln(relative share) and read the residuals to see who over or under earns for its share.

### 6.4 Market environments SRC p.154, p.155

| Region | Rule of thumb | Implication |
|---|---|---|
| Sub-scale | Share index below about 1:3 to 1:2.5 of the main competitor | Not viable as a go-alone proposition; ally or exit |
| Critical mass | From about 1:2.5 up to roughly 1.5:1 | Viable ongoing business |
| Dominant | Above roughly 1.5:1 INTERP: axis printed "1:1.5" right of 1:1 | Major barriers for the competitor |
| High growth, no entrenched competitor | Growth above about 12% a year and share above the sub-scale cut-off | Grow the market; use first mover advantage. The high growth, sub-scale corner is blank in the source. |

The strategic shifts that followed in the source case: from investing everywhere to selective investment where near-parity is achievable (spin off dead end assets); from head-on, go-alone competition to alliances in low critical mass markets; from price attacks in competitor strongholds to avoiding hostile fights there while driving customer value; from short term profit extraction to building a viable system; from speed to sustainability; from shifting priorities to consistency in investment, marketing and organisation. A further finding: all the value in that industry came from one structural model (franchise rather than company owned bottling), for the client and its competitor alike SRC p.152.

## 7. Consumer demand and customers

### 7.1 Ranking demand levers SRC p.126, p.127

Use multivariable regression across outlets or markets to isolate the effect of each lever (price, inventory depth, media, region, demographics) on demand. Rank by standardised coefficient. In the source case new release inventory had three to four times the impact of the next lever (catalogue price, then new release price), in both competitive and non-competitive stores; regional and demographic variables mattered far less.

### 7.2 Prototypical operating environments SRC p.128

Segment outlets or markets by the conditions they face, then give each segment its own objective:
1. Competitive environment: ultra-competitive, competitive, non-competitive, premium.
2. Market concentration and position: saturated or not; weak or strong position.
3. Maturity: new, young, developing, mature.
4. Performance: over, average, under.

Objectives by segment: maximise volume; maximise market share; grow market share; establish a customer base; maximise revenue; grow revenue; win back the customer base.

### 7.3 Price response: find the plateaus SRC p.129, p.130

Price response curves are rarely smooth; look for kinks and plateaus instead of applying one elasticity. In the source case (competitive stores, changes measured against a $3.49 base):
- Between $1.99 and $2.49 volume moved substantially with almost no revenue change (a revenue plateau): volume can be bought cheaply.
- Between $2.49 and $2.99 volume was flat (volume inelastic): revenue can be raised with little volume risk.
- Above $3.49 volume fell fast (elastic).

Classify each price interval by arc (midpoint) elasticity; the reference code does this. The end product in the source was a store level pricing tool: input location, segment, current and proposed prices; output volume and revenue change in percent and absolute terms.

### 7.4 Customer segmentation SRC p.165 to 170

Techniques: cluster analysis; profitability by customer (from the spine); conjoint analysis; price elasticity analysis; image cost theory.
1. Select active behavioural variables (from a survey or transaction data).
2. Principal components analysis to find the underlying axes (in the source: informed vs not informed, active vs passive, each explaining under a fifth of variance).
3. Map secondary variables (share, wealth) onto the axes to draw cluster borders.
4. Size each cluster (volume, value) and analyse competition within it.
5. Map which levers matter in each cluster (asset management, brand, cost efficiency, service level) and align channels and structure to them. Example action: build a sales force for high-end passive clients.

### 7.5 Share gap opportunities SRC p.148 to 151

- Dissect share by industry × geography (transaction data, a company database such as Dun & Bradstreet, and a volume model by industry and company size).

- Volume gap = max(0, benchmark share - actual share) × market size per region, industry and their combinations; rank them and focus on the top third.

- Drill down to accounts by size band and presence (no presence, low share, high share) to set priorities and achievement goals.

- Large disparities with few structural explanations point to operational under-performance. The source's output was a tool the sales force used to set goals and coverage.

## 8. New markets and megatrends

### 8.1 New market entry SRC p.156 to 161

Techniques: macroeconomic trend analysis; market driver analysis; substitution analysis; discontinuity identification; scenario building.
1. Define the universe with an exhaustive needs framework so no segment is missed. The source used Maslow's hierarchy (self-actualisation, esteem, love and affection, safety and shelter, health) plus "enablers" (daily logistics, life planning and finances).
2. Size every segment (65 in the source) and split it by target group.
3. Filter in sequence: attractiveness to an outsider; attractiveness within the target group; adjacency to the core business; ability to "repeat the trick" with proprietary skills.
4. Synthesise: integrate the filters and group segments into thematic bundles. Source yield: 70+ segments passing basic rules, 10+ very attractive ($200B revenue pool), 2 actionable near term.
5. Size the chosen opportunities with simple driver trees (population × share in target group × spend) and project them.

Qualifying rules used for segments: they must meet a real need, be focused on the target group, be a service or a product with a significant service component, and support a profit motive.

### 8.2 Megatrend assessment SRC p.162 to 164

- Define each megatrend, its degree of change over time, and its impact by geography and industry.

- Translate it into uncertainties for customers: strategy, skill set, organisational structure and processes, management control systems, implementation.

- Derive the implications for the business's specialist skills, credibility and relationships, and industry expertise.

- Look for new value propositions on two axes: relationship value (outsourcing, alliances, deeper entanglement) and information value (selling proprietary knowledge). High on both: ventures that circumvent the customer's SG&A wallet, carve out a piece of the economy, or disintermediate customers.

## 9. Organisation SRC p.136 to 144

- Organisational shift: design the blueprint, key processes and staffing; run an implementation task force; launch on a fixed timetable (100 days in the source). Start by mapping the current task structure (for example field sales hours by task) before specifying the desired one SRC p.137, p.139, p.140.

- Benchmarking a winning formula: test four mechanisms for each constituency (operations, suppliers, marketers): carrots (incentives, growth opportunity), empowerment (transfer of best practice, training, investment in the right people and partners), checks (evaluations, inspections, performance data), teeth (real consequences). Flag where the company is weak; some elements can be copied, others need scale it lacks SRC p.142 to 144.

## 10. Applying the framework to public companies ADAPT

### 10.1 What public data supports

| Module | Feasibility | Typical inputs |
|---|---|---|
| Strategic segmentation and battlefields | High | 10-K business and segment descriptions; competitor overlap; customer and channel disclosures |
| Profit pools and whale curves | Medium | Segment and geographic disclosures; product line commentary; earnings calls |
| Slopes and cost drivers | Low to medium | Plant and capacity data; industry studies; company disclosures of scale or utilisation effects |
| Competitor cost positions and gap bridges | Medium | Segment margins; plant counts and sizes; headcount; wage data; expert input |
| Cost histogram pricing | Medium to high in commodities | Industry cost curves (mining, chemicals, building materials, energy, paper) |
| Relative share and market environments | Medium | Industry share data; company volumes by market |
| Demand levers and price response | Medium | Price trackers, store or traffic data, company KPIs (price, mix, volume) |
| Customer segmentation | Low | Surveys; panel data |
| New markets and megatrends | Medium | Market sizing sources; adjacency analysis |

### 10.2 Signals to look for

- Battlefield map: which battlefields the company fights on, its key purchase criteria position in each, and who it meets there.

- Relative cost position by spine stage against peers; structural vs operational split; whether the gap is closing or widening.

- Cost curve position in commodity industries: marginal producer cost, implied price band, and how planned capacity additions move it.

- Slope exposure: which driver has the steepest slope, and what expected changes in volume, run length or scale do to unit cost.

- Share line residuals: companies earning well above or below what their relative share predicts.

- Market environment mix: share of revenue in sub-scale, critical mass and dominant markets; whether strategy fits each (alliances where sub-scale).

- Profit concentration: how much profit comes from a few segments (sanctuaries) and how exposed those are to a focused attack; loss leaders.

- Complexity: SKU or customer proliferation and the size of the unprofitable tail; pruning potential.

- Pricing headroom: evidence of volume inelastic zones (room to raise price) or revenue plateaus (room to buy volume).

- Demand lever mix: whether spend is going to the levers that move demand most.

- Share gaps: regions or verticals where the company under-indexes its own benchmark share without a structural reason.

- Megatrend and adjacency exposure: new segments that pass the four filters for the company.

### 10.3 Insight template

Observation:  one sentence, with the number and the period
Evidence:     data points and their sources
Driver:       which activity, cost variable, demand lever or structural factor explains it
Type:         structural / operational
Event link:   the business event behind it, or "unexplained"
Implication:  the resource realignment it points to (scope, efficiency, offense or defense, target)
Confidence:   high / medium / low, with the reason
Caveats:      disclosure limits, assumptions, triangulation gaps

## 11. Implementation specification ADAPT

### 11.1 Input schema

company: "name or ticker"
segmentation:
  axes: [product_type, technology, customer, channel, geography, competitors]
  families:
    - {name: "family A", competitors: [X, Y], technology: "T1", customers: "OEM", volume: "large"}
spine:                               # per unit, for one cube cell or the whole business
  unit: "per 1,000 units"
  activities:
    - {name: purchased_materials, client_cost: 500, driver: purchase_volume, client_driver: 100, slope: 0.90, type: structural}
    - {name: transformation, client_cost: 250, driver: run_length, client_driver: 50, slope: 0.60, type: operational}
competitors:
  - {name: X, drivers: {purchased_materials: 200, transformation: 75}, sources: ["plant visit", "permit filing"]}
cost_driver_data:                    # for fitting slopes
  - {activity: transformation, driver_values: [], unit_costs: []}
units:                               # whale curves: SKUs, customers, regions
  - {name: "SKU 1", revenue: 0, operating_profit: 0}
gap_bridge:
  start: -13.9
  items: [{label: "export support", value: -11.0, kind: non_economic}]
plants:                              # cost histogram
  - {name: "Plant A", capacity: 40, delivered_cost: 60}
market_demand: 90
markets:                             # environments, share line, share gaps
  - {name: "Market 1", share_index: 1.2, growth: 0.04, ros: 0.15, size: 100, own_share: 0.30}
price_points: {prices: [1.49, 1.99], volumes: [1.39, 1.30]}
demand_data: {demand: [], levers: {inventory: [], price: [], media: []}}

### 11.2 Output schema

{
  "company": "",
  "battlefields": [{"name": "", "families": [], "ksf": [], "customer_requests": [], "route_to_customer": ""}],
  "spine": {"activities": [], "cost_share": {}},
  "slopes": [{"activity": "", "driver": "", "slope": 0.0, "r2": 0.0, "type": "structural|operational"}],
  "competitor_positions": [{"competitor": "", "cost_by_activity": {}, "gap_by_activity": {}, "total_gap": 0.0, "flags": []}],
  "derivative_spine": {},
  "gap_bridge": {"economic_start": 0.0, "economic_gap": 0.0, "structural_share": 0.0, "by_kind": {}},
  "profit_pools": {"peak_cumulative_profit": 0.0, "unprofitable_count_share": 0.0, "unprofitable_revenue_share": 0.0},
  "industry": {"price_band": {"floor": 0.0, "ceiling": 0.0, "last_entrant": "", "first_loser": ""},
               "share_line": {"ros_at_parity": 0.0, "gain_per_doubling": 0.0},
               "market_environments": [{"market": "", "environment": ""}]},
  "demand": {"lever_ranking": [], "price_zones": []},
  "opportunities": {"volume_gaps": [], "new_segments": []},
  "insights": [],
  "flags": [],
  "sources": {}
}

### 11.3 Pipeline

- Segment into battlefields (Section 2) and decide the cube cells to cost.

- Build the spine for the company; allocate with the best available method (Section 3.5); record allocation quality per line.

- Fit slopes where driver data exist (fit_slope); otherwise use documented slopes from prior studies and flag them.

- Position competitors (competitor_cost_position), triangulate against aggregates, then compute the derivative spine.

- Bridge reported to economic EBIT and classify gaps (gap_bridge).

- Profit pools for the company and competitors (whale_curve).

- Industry: cost histogram price band, share line, market environments.

- Demand: lever ranking, price zones, share gaps.

- Opportunities: filters and sizing for new segments.

- Synthesise with the insight template; every number carries a source.

### 11.4 Reference implementation (Python, standard library only)
Reference implementation, Python (254 lines). Click to expand
"""Reference implementation of the Industry and Company Analysis Framework.

Pure functions, standard library only, no I/O. Rates as decimals (0.12 = 12%).
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, Tuple

DEFAULTS = {
    "subscale_share_index": 0.40,   # 1:2.5 (source band is 1:3 to 1:2.5)
    "dominant_share_index": 1.50,   # about 1.5:1
    "high_growth": 0.12,            # market growth line on the environment map
    "inelastic_max": 0.30,          # |arc elasticity| below this: raise price
    "plateau_band": (0.70, 1.30),   # |arc elasticity| in this band: revenue flat
}

# ---------------------------------------------------------------- trends
def log_trend_cagr(values: Sequence[float]) -> Optional[float]:
    """Least squares fit of ln(value) on time; returns exp(slope) - 1."""
    if len(values) < 2 or any(v <= 0 for v in values):
        return None
    n = len(values)
    xbar = (n - 1) / 2
    ys = [math.log(v) for v in values]
    ybar = sum(ys) / n
    sxy = sum((x - xbar) * (y - ybar) for x, y in enumerate(ys))
    sxx = sum((x - xbar) ** 2 for x in range(n))
    return math.exp(sxy / sxx) - 1

def _log_sse(vals: Sequence[float]) -> float:
    n = len(vals)
    xbar = (n - 1) / 2
    ys = [math.log(v) for v in vals]
    ybar = sum(ys) / n
    sxx = sum((x - xbar) ** 2 for x in range(n))
    b = sum((x - xbar) * (y - ybar) for x, y in enumerate(ys)) / sxx
    a = ybar - b * xbar
    return sum((y - (a + b * x)) ** 2 for x, y in enumerate(ys))

def split_trend(values: Sequence[float], min_seg: int = 4) -> dict:
    """Best single break for two log-linear fits (segments share the break
    point). Use when a series shows an inflection; report both rates."""
    if any(v <= 0 for v in values) or len(values) < 2 * min_seg - 1:
        return {}
    best = None
    for b in range(min_seg - 1, len(values) - min_seg + 1):
        sse = _log_sse(values[:b + 1]) + _log_sse(values[b:])
        if best is None or sse < best[0]:
            best = (sse, b)
    b = best[1]
    return {"break_index": b,
            "cagr_before": log_trend_cagr(values[:b + 1]),
            "cagr_after": log_trend_cagr(values[b:])}

# ---------------------------------------------------------------- cost curves
def cost_curve(cost0: float, driver0: float, driver: float, slope: float) -> float:
    """Unit cost at a new driver value. slope = cost multiplier per doubling."""
    return cost0 * (driver / driver0) ** math.log2(slope)

def fit_slope(drivers: Sequence[float], costs: Sequence[float]) -> dict:
    """Fit ln(cost) = a + b ln(driver). Returns slope = 2**b and R squared."""
    xs = [math.log(d) for d in drivers]
    ys = [math.log(c) for c in costs]
    n = len(xs)
    xbar, ybar = sum(xs) / n, sum(ys) / n
    sxx = sum((x - xbar) ** 2 for x in xs)
    b = sum((x - xbar) * (y - ybar) for x, y in zip(xs, ys)) / sxx
    a = ybar - b * xbar
    ss_res = sum((y - (a + b * x)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - ybar) ** 2 for y in ys)
    return {"slope": 2 ** b, "elasticity": b,
            "r2": 1 - ss_res / ss_tot if ss_tot else 1.0}

def competitor_cost_position(activities: Dict[str, dict],
                             competitor_drivers: Dict[str, float]) -> dict:
    """Estimate a competitor's unit cost activity by activity.
    activities: {name: {"client_cost": c, "client_driver": d, "slope": s}}
    competitor_drivers: {name: competitor's driver value}
    Activities without a driver or slope are assumed at parity (flagged)."""
    out, flags = {}, []
    for name, a in activities.items():
        d_comp = competitor_drivers.get(name)
        if d_comp is None or a.get("slope") is None or a.get("client_driver") is None:
            out[name] = a["client_cost"]
            flags.append(f"{name}: assumed parity (no driver or slope)")
        else:
            out[name] = cost_curve(a["client_cost"], a["client_driver"], d_comp, a["slope"])
    client_total = sum(a["client_cost"] for a in activities.values())
    comp_total = sum(out.values())
    gaps = {k: activities[k]["client_cost"] - v for k, v in out.items()}
    return {"competitor_cost": out, "gap_by_activity": gaps,
            "client_total": client_total, "competitor_total": comp_total,
            "total_gap": client_total - comp_total, "flags": flags}

def derivative_spine(gaps_by_activity: Dict[str, float]) -> Dict[str, float]:
    """Share of total competitor cost gap by activity (the actionable zones)."""
    tot = sum(gaps_by_activity.values())
    return {k: v / tot for k, v in gaps_by_activity.items()}

# ---------------------------------------------------------------- profit pools
def whale_curve(units: Sequence[Tuple[str, float, float]]) -> dict:
    """units: (name, revenue, operating_profit). Ranks by margin, returns the
    cumulative profit curve and the unprofitable tail."""
    ranked = sorted(units, key=lambda u: -(u[2] / u[1]) if u[1] else 0)
    cum, curve = 0.0, []
    for name, rev, prof in ranked:
        cum += prof
        curve.append((name, prof / rev if rev else None, cum))
    losers = [u for u in units if u[2] < 0]
    tot_rev = sum(u[1] for u in units)
    return {"ranked": curve,
            "peak_cumulative_profit": max(c for _, _, c in curve),
            "total_profit": cum,
            "unprofitable_count_share": len(losers) / len(units),
            "unprofitable_revenue_share": sum(u[1] for u in losers) / tot_rev,
            "unprofitable_loss": sum(u[2] for u in losers)}

def gap_bridge(start: float, items: Sequence[Tuple[str, float, str]]) -> dict:
    """Walk from one profit figure to another. items: (label, value, kind) with
    kind in {"non_economic", "mix", "structural", "closable"}. Positive values
    raise the client toward the comparator."""
    by_kind: Dict[str, float] = {}
    for _, v, kind in items:
        by_kind[kind] = by_kind.get(kind, 0.0) + v
    economic_start = start + by_kind.get("non_economic", 0.0) + by_kind.get("mix", 0.0)
    efficiency = by_kind.get("structural", 0.0) + by_kind.get("closable", 0.0)
    return {"by_kind": by_kind, "economic_start": economic_start,
            "end": economic_start + efficiency,
            "economic_gap": efficiency,
            "structural_share": (by_kind.get("structural", 0.0) / efficiency) if efficiency else None}

# ---------------------------------------------------------------- industry
def cost_histogram_price_band(plants: Sequence[Tuple[str, float, float]], demand: float) -> dict:
    """plants: (name, capacity, full delivered cost incl. return on capital).
    Fill demand from the cheapest plant up. The theoretical price lies between
    the last plant needed (last entrant) and the next one (first loser)."""
    ranked = sorted(plants, key=lambda p: p[2])
    cum, last, first_loser = 0.0, None, None
    for p in ranked:
        if cum < demand:
            last = p
            cum += p[1]
        elif first_loser is None:
            first_loser = p
    return {"last_entrant": last, "first_loser": first_loser,
            "price_floor": last[2] if last else None,
            "price_ceiling": first_loser[2] if first_loser else None,
            "spare_capacity": cum - demand}

def share_profit_line(share_ratios: Sequence[float], ros: Sequence[float]) -> dict:
    """Fit ROS = a + b ln(relative share). Residuals show who over or under
    earns for its share."""
    xs = [math.log(r) for r in share_ratios]
    n = len(xs)
    xbar, ybar = sum(xs) / n, sum(ros) / n
    b = sum((x - xbar) * (y - ybar) for x, y in zip(xs, ros)) / sum((x - xbar) ** 2 for x in xs)
    a = ybar - b * xbar
    return {"a_ros_at_parity": a, "b_per_log_ratio": b,
            "ros_gain_per_doubling": b * math.log(2),
            "residuals": [y - (a + b * x) for x, y in zip(xs, ros)]}

def market_environment(share_index: float, growth: float, cfg: dict = DEFAULTS) -> str:
    """Market environment map (source p.154). share_index = own share / main
    competitor's share; growth = annual market growth."""
    if growth > cfg["high_growth"]:
        return ("HIGH_GROWTH_OPEN" if share_index >= cfg["subscale_share_index"]
                else "HIGH_GROWTH_SUBSCALE_UNCLASSIFIED")
    if share_index < cfg["subscale_share_index"]:
        return "SUB_SCALE"
    if share_index <= cfg["dominant_share_index"]:
        return "CRITICAL_MASS"
    return "DOMINANT"

# ---------------------------------------------------------------- demand
def price_response_zones(prices: Sequence[float], volumes: Sequence[float],
                         cfg: dict = DEFAULTS) -> List[dict]:
    """Classify each adjacent price interval by arc (midpoint) elasticity.
    prices ascending; volumes as levels or indices."""
    lo_band, hi_band = cfg["plateau_band"]
    out = []
    for i in range(len(prices) - 1):
        p1, p2, q1, q2 = prices[i], prices[i + 1], volumes[i], volumes[i + 1]
        dq = (q2 - q1) / ((q1 + q2) / 2)
        dp = (p2 - p1) / ((p1 + p2) / 2)
        e = dq / dp
        drev = (p2 * q2) / (p1 * q1) - 1
        ae = abs(e)
        if ae < cfg["inelastic_max"]:
            zone = "VOLUME_INELASTIC"   # higher price lifts revenue with little volume risk
        elif lo_band <= ae <= hi_band:
            zone = "REVENUE_PLATEAU"    # lower price buys volume at little revenue cost
        elif ae > hi_band:
            zone = "ELASTIC"            # raising price loses revenue
        else:
            zone = "MODERATE"
        out.append({"from": p1, "to": p2, "arc_elasticity": e,
                    "volume_change": q2 / q1 - 1, "revenue_change": drev, "zone": zone})
    return out

def _solve(a: List[List[float]], b: List[float]) -> List[float]:
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[piv] = m[piv], m[c]
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                for k in range(c, n + 1):
                    m[r][k] -= f * m[c][k]
    return [m[i][n] / m[i][i] for i in range(n)]

def demand_lever_ranking(levers: Dict[str, Sequence[float]], demand: Sequence[float]) -> List[dict]:
    """Multivariable OLS on z-scored variables. Ranks levers by |standardised
    coefficient| and also returns raw coefficients (demand units per lever unit)."""
    names = list(levers)
    n = len(demand)

    def z(v):
        mu = sum(v) / n
        sd = math.sqrt(sum((x - mu) ** 2 for x in v) / (n - 1))
        return [(x - mu) / sd for x in v], sd

    zy, sdy = z(demand)
    zx, sdx = {}, {}
    for k in names:
        zx[k], sdx[k] = z(levers[k])
    xtx = [[sum(zx[i][t] * zx[j][t] for t in range(n)) for j in names] for i in names]
    xty = [sum(zx[i][t] * zy[t] for t in range(n)) for i in names]
    beta = _solve(xtx, xty)
    rows = [{"lever": k, "std_coef": b, "raw_coef": b * sdy / sdx[k]} for k, b in zip(names, beta)]
    return sorted(rows, key=lambda r: -abs(r["std_coef"]))

def volume_gap(regions: Sequence[Tuple[str, float, float]], benchmark_share: float) -> List[Tuple[str, float]]:
    """regions: (name, market_size, own_share). Volume gap vs a benchmark share."""
    out = [(n, max(0.0, benchmark_share - s) * m) for n, m, s in regions]
    return sorted(out, key=lambda x: -x[1])

### 11.5 Test cases (all pass with the code above)

| Test | Input | Expected |
|---|---|---|
| Slope SRC p.70 | Cost 80 at run length 10, slope 75%, run length 20 | 60 |
| Purchasing slope SRC p.66 | Cost 100, slope 95%, volume × 4 | 90.25 |
| Competitor position SRC p.74 | 2,500 at 50K, slope 60% | ≈3,252 at 35K; ≈1,854 at 75K |
| Multi-activity position | Purchased 500 (volume 100→200, 90%); transformation 250 (run length 50→75, 60%); overhead 250 (volume 100→200, 80%); freight 40, no driver | Gaps 50.0 / 64.6 / 50.0 / 0 (freight flagged as parity); total 164.6 |
| Derivative spine SRC p.77 | Gaps 100 / 100 / 100 | One third each |
| Gap bridge SRC p.88 | Start -13.9; export support -11.0, cost allocation -1.5, royalties +0.6; scale +20.3 (structural); packaging +4.0, utilisation +6.0, operating performance +8.9, sourcing +4.6, recipes +0.2, organisation -10.0, other and mix +5.6 | Economic start -25.8 (as on slide); economic gap 39.6 (slide "around 40"); structural share 51% (slide "about 50%"); end 13.8 (slide shows 13.4, rounding) |
| Whale curve | A 200/+25, B 198/+5, C 100/-2, D 51/-8 | Peak cumulative profit 30, total 20, unprofitable revenue share 27.5%, loss -10 |
| Price band | Plants (capacity @ cost): A 40@60, B 30@70, C 15@82, D 10@95, E 12@110; demand 90 | Last entrant D (95), first loser E (110), spare 5 |
| Share line | ROS = 12% + 5%·ln(ratio) at ratios 0.1 to 5 | a = 12%, b = 5%, +3.5 pts per doubling |
| Market environment | (share index, growth): (0.3, 5%), (1.0, 4%), (3.0, 3%), (1.0, 20%), (0.2, 20%) | Sub-scale, critical mass, dominant, high growth open, high growth sub-scale (unclassified) |
| Price zones SRC p.129 | Prices 1.49 to 3.99; volume index 1.39, 1.30, 1.06, 1.06, 1.00, 0.81 (read from the chart) | Inelastic, revenue plateau (1.99 to 2.49), inelastic (2.49 to 2.99), moderate, elastic above 3.49; matches the slide's findings |
| Demand levers | Simulated demand = 2 + 1.3·inventory − 0.6·price + 0.2·media + noise | Ranking inventory, price, media; raw coefficients ≈ 1.3, −0.6, 0.2 |
| Volume gap | Regions (size, share): X 100/56%, Y 52/11%, Z 78/10%; benchmark 43% | Z 25.7, Y 16.6, X 0 |
| Trend split | 10 years at 20% then 9 at 12% | Blended 15.9% (misleading); split 20% then 12% |

## 12. Pattern library (lessons from the source's cases)

- A big unprofitable tail is common: 40% of SKUs, about 30% of sales, lost money in one case SRC p.57.

- Profitability varies widely by geography and vertical, and each vertical gets to its margin differently SRC p.59, p.61.

- Under-penetrated, high margin customer bands are growth opportunities SRC p.62.

- Actionable gaps differ from cost shares (derivative spine) SRC p.77.

- Normalise before comparing: non-economic items hid about a third of one economic gap SRC p.88.

- About half of a gap can be structural; act on the rest and turn the competitor's weaknesses into advantages SRC p.88.

- Process technology advantages can be copied: a 5 point cost gap was cut to 2 SRC p.114.

- When structural gaps are too large, exit or outsource SRC p.118.

- Commodity prices follow the cost histogram; judge consolidation by each player's NPV of earnings SRC p.132 to 135.

- Relative share drives profit; below critical mass, ally rather than fight head-on SRC p.153 to 155.

- Industry structure choices can decide where value is created (franchise vs owned bottling) SRC p.152.

- Competitors' profits concentrate in a few sanctuaries, often protected by loss leaders elsewhere SRC p.80, p.81.

- Laser strikes beat carpet bombing: attack the sanctuaries and the fragile channel partners SRC p.84 to 86.

- One demand lever can dominate: inventory depth had three to four times the effect of price SRC p.127.

- Price curves have plateaus and inelastic zones; exploit the kinks SRC p.129.

- Big share disparities with few structural causes mean operational under-performance SRC p.148.

- Cost drivers interact; sequence actions and net out effects SRC p.72.

- Recycle savings from closed gaps into the portfolio and into demand building to restart growth SRC p.91, p.111.

- Winning formulas rest on carrots, empowerment, checks and teeth; some parts need scale SRC p.142 to 144.

## 13. Glossary

| Term | Definition |
|---|---|
| Strategic battlefield | A strategic segment whose businesses share competitors, technology, customers and leverage points |
| KSF | Key success factor (key leverage point) in a battlefield |
| Strategic spine | Total delivered cost organised by activity rather than by nature |
| Activity | A discrete stage in creating and delivering a product, governed by predictable economic rules |
| Cube | Spine costs broken out by product × channel × geography (or other axes) |
| Cost variable / driver | What determines efficiency in an activity; structural or operational |
| Slope | Unit cost multiplier when the driver doubles |
| Derivative spine | Activities weighted by competitor cost gaps (the actionable zones) |
| Grabs | Quantified savings from optimising interdependent cost drivers |
| Economic EBIT | Reported EBIT after removing non-economic items such as subsidies, internal cost allocations and royalties |
| Whale curve | Units ranked by profitability with width proportional to size |
| Profit sanctuary | A segment that produces a large share of a player's profit |
| Cost histogram | Industry cost curve of plants by delivered cost against cumulative capacity |
| Last entrant / first loser | Marginal plant needed to meet demand / next plant excluded; together they bound the theoretical price |
| Share index | Own market share divided by the main competitor's |
| Prototypical operating environment | A class of outlets or markets sharing conditions and therefore objectives |
| Revenue plateau | Price interval where volume changes with little effect on revenue (arc elasticity near 1) |
| Volume inelastic zone | Price interval where volume barely responds (arc elasticity near 0) |
| Volume gap | Benchmark share minus actual share, times market size |