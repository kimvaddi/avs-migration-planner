# Changelog

## [1.1.0] - 2026-03-31

### Excel Report Export
- **Excel report export** — Professional 7-sheet `.xlsx` workbook with Input Fields, Node Sizing, Node Selection Guide, Pricing & Cost, VM Inventory, Wave Plan, and SKU Reference. Color coded, auto-filtered, currency-formatted. Uses `exceljs`.

### Node Selection Guide
- **Node Selection Guide** — Architect-level recommendation rationale per node type with verdict (★ RECOMMENDED / ○ SUITABLE / ✗ NOT RECOMMENDED), cost efficiency metrics ($/vCPU, $/GB RAM, $/TB storage), waste analysis, workload archetypes, regional availability warnings, external storage suggestions, and Microsoft Learn source links.

### Sizing Engine Overhaul
- **vSAN storage formula** — Replaced flat 35% usable multiplier with proper calculation: `raw / FTT_overhead × (1 - vSAN_slack) × dedup_ratio`. Aligns with AVS License Calculator v4.04.
- **CPU overcommit ratios** — Configurable 4:1 (production default) or 8:1 (dev/test). Replaces HT-based calculation.
- **Memory overcommit** — Configurable ratio with explicit 10% vSphere overhead.
- **N+1 HA policy** — Automatically adds one spare node for host failure tolerance (configurable).
- **Driving dimension** — Each recommendation now reports which resource (CPU/Memory/Storage) is the binding constraint.
- **SizingConfig interface** — All sizing parameters (overcommit, dedup, FTT, slack, HA) are configurable via a single config object.

### Bug Fixes
- **AV64 raw storage corrected** — Fixed from 15.36 TB (OSA variant) to 21.12 TB (11×1920 GB NVMe, Gen 2).
- **All node usable capacities recalculated** — Using proper vSAN formula instead of flat multiplier.
- **Disk-level specs added** — `diskCount` and `diskSizeGB` fields on all node types.

### Cost Estimation
- **Multi-year TCO** — `calculateTCO()` produces 1 to 5-year consumption plans with yearly breakdown.
- **Defender for Servers** — Microsoft Defender Plan 2 cost per VM ($14.60/mo default).
- **Defender for SQL** — Per-DB server cost ($15.00/mo default).
- **Custom discounts** — EA/CSP negotiated RI and PAYG discount rates supported.
- **SQL VM detection** — `detectSqlVMs()` identifies SQL/DB VMs by name pattern for Defender cost modeling.

### Regional Availability
- **37-region availability matrix** — Tracks which regions support Gen 2 nodes and stretched clusters.
- **ARM region mapping** — Bidirectional mapping between ARM names (e.g., `eastus`) and display names (e.g., `US East`).
- **`getAvailableNodeTypes(region)`** — Returns which node SKUs are available in a given region.

### Technical
- 198 unit tests across 10 test suites (was 162 across 8)
- New module: `src/generators/excelGenerator.ts`
- New module: `src/analyzers/nodeAdvisor.ts`
- New test suite: `src/test/unit/excelGenerator.test.ts`
- New test suite: `src/test/unit/nodeAdvisor.test.ts`
- Added `exceljs` as runtime dependency for Excel export
- Sizing methodology cross-validated against AVS License Calculator v4.04 (LYB AVS)

## [1.0.0] - 2026-03-30

### Features
- **VM Inventory Import** — RVTools vInfo CSV, standard CSV, semicolon-delimited (EU) formats with auto-detection
- **Multi-NIC Parsing** — Reads Network #1 through #4 columns from RVTools exports
- **AVS Node Sizing** — Recommendations across 5 node types: AV36, AV36P, AV52 (Gen 1), AV48, AV64 (Gen 2)
- **Live Pricing** — Real-time pricing from Azure Retail Prices API (prices.azure.com), offline fallback included
- **Cost Comparison** — Pay-As-You-Go, 1-Year RI, 3-Year RI side-by-side for all node types
- **Migration Wave Planner** — Smart 3-tier grouping (dependency → network affinity → tier ordering: infra→DB→app→web)
- **HCX Configuration** — Auto-generated mobility groups and network extensions per wave
- **Bicep Templates** — AVS Private Cloud, ExpressRoute Global Reach, NSX-T segments with configurable CIDR
- **Interactive Dashboard** — Full HTML dashboard with metrics, tables, risk badges
- **AI-Assisted Mode** — `@avs` Copilot Chat participant with /analyze, /recommend, /risk, /optimize, /explain commands
- **Save As Exports** — CSV (wave plan), JSON (HCX), Markdown (report), Bicep (templates)
- **Configurable Settings** — Wave limits, throughput, pricing region via VS Code settings
- **Session Persistence** — Imported data survives VS Code restarts

### Technical
- Node specs validated against [official Microsoft Learn documentation](https://learn.microsoft.com/azure/azure-vmware/introduction)
- HCX throughput based on [VMware HCX 4.10 Configuration Maximums](https://configmax.broadcom.com/)
- 130 unit tests across 7 test suites
- Zero runtime dependencies — all logic self-contained
- Strict Content Security Policy on webviews
- No telemetry, no tracking
